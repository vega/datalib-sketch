var TYPED_ARRAYS = typeof ArrayBuffer !== 'undefined',
    EPSILON = 1e-300,
    DEFAULT_COMPRESS = 100;

// Create a new t-digest sketch for quantile and histogram estimation.
// See: 'Computing Extremely Accurate Quantiles using t-Digests'
// by T. Dunning & O. Ertl.
// Based on the Ted Dunning's merging digest implementation at:
// https://github.com/tdunning/t-digest
// Argument *compress* is the compression factor, defaults to 100, max 1000.
function TDigest(compress) {
  var cf = compress || DEFAULT_COMPRESS, tempsize, size;
  cf = cf < 20 ? 20 : cf > 1000 ? 1000: cf;
  // magic formula from regressing against known sizes for sample cf's
  tempsize = ~~(7.5 + 0.37*cf - 2e-4*cf*cf);
  // should only need ceil(cf * PI / 2), double allocation for safety
  size = Math.ceil(Math.PI * cf);

  this._cf = cf; // compression factor

  this._totalSum = 0;
  this._last = 0;
  this._weight = numArray(size);
  this._mean = numArray(size);
  this._min = Number.MAX_VALUE;
  this._max = -Number.MAX_VALUE;

  this._unmergedSum = 0;
  this._mergeWeight = numArray(size);
  this._mergeMean = numArray(size);

  this._tempLast = 0;
  this._tempWeight = numArray(tempsize);
  this._tempMean = numArray(tempsize);
  this._order = [];
}

function numArray(size) {
  return TYPED_ARRAYS ? new Float64Array(size) : Array(size);
}

function integrate(cf, q) {
  return cf * (Math.asin(2 * q - 1) + Math.PI / 2) / Math.PI;
}

function interpolate(x, x0, x1) {
  return (x - x0) / (x1 - x0);
}

// Create a new t-digest sketch from a serialized object.
TDigest.import = function(obj) {
  var td = new TDigest(obj.compress);
  var sum = 0;
  td._min = obj.min;
  td._max = obj.max;
  td._last = obj.mean.length - 1;
  for (var i=0, n=obj.mean.length; i<n; ++i) {
    td._mean[i] = obj.mean[i];
    sum += (td._weight[i] = obj.weight[i]);
  }
  td._totalSum = sum;
  return td;
};

var proto = TDigest.prototype;

// Add a value to the t-digest.
// Argument *v* is the value to add.
// Argument *count* is the integer number of occurrences to add.
// If not provided, *count* defaults to 1.
proto.add = function(v, count) {
  if (v == null || v !== v) return; // ignore null, NaN
  count = count || 1;
  
  if (this._tempLast >= this._tempWeight.length) {
    this._mergeValues();
  }

  var n = this._tempLast++;
  this._tempWeight[n] = count;
  this._tempMean[n] = v;
  this._unmergedSum += count;
};

proto._mergeValues = function() {
  if (this._unmergedSum === 0) return;

  var tw = this._tempWeight,
      tu = this._tempMean,
      tn = this._tempLast,
      w = this._weight,
      u = this._mean,
      n = 0,
      order = this._order,
      sum = 0, ii, i, j, k1;

  // get sort order for temp values
  order.length = tn;
  for (i=0; i<tn; ++i) order[i] = i;
  order.sort(function(a,b) { return tu[a] - tu[b]; });

  if (this._totalSum > 0) {
    if (w[this._last] > 0) {
      n = this._last + 1;
    } else {
      n = this._last;
    }
  }
  this._last = 0;
  this._totalSum += this._unmergedSum;
  this._unmergedSum = 0;

  // merge tempWeight,tempMean and weight,mean into mergeWeight,mergeMean
  for (i=j=k1=0; i < tn && j < n;) {
    ii = order[i];
    if (tu[ii] <= u[j]) {
      sum += tw[ii];
      k1 = this._mergeCentroid(sum, k1, tw[ii], tu[ii]);
      i++;
    } else {
      sum += w[j];
      k1 = this._mergeCentroid(sum, k1, w[j], u[j]);
      j++;
    }
  }
  for (; i < tn; ++i) {
    ii = order[i];
    sum += tw[ii];
    k1 = this._mergeCentroid(sum, k1, tw[ii], tu[ii]);
  }
  for (; j < n; ++j) {
    sum += w[j];
    k1 = this._mergeCentroid(sum, k1, w[j], u[j]);
  }
  this._tempLast = 0;

  // swap pointers for working space and merge space
  this._weight = this._mergeWeight;
  this._mergeWeight = w;
  for (i=0, n=w.length; i<n; ++i) w[i] = 0;

  this._mean = this._mergeMean;
  this._mergeMean = u;

  if (this._weight[n = this._last] <= 0) --n;
  this._min = Math.min(this._min, this._mean[0]);
  this._max = Math.max(this._max, this._mean[n]);
};

proto._mergeCentroid = function(sum, k1, wt, ut) {
  var w = this._mergeWeight,
      u = this._mergeMean,
      n = this._last,
      k2 = integrate(this._cf, sum / this._totalSum);

  if (k2 - k1 <= 1 || w[n] === 0) {
    // merge into existing centroid
    w[n] += wt;
    u[n] = u[n] + (ut - u[n]) * wt / w[n];
  } else {
    // create new centroid
    this._last = ++n;
    u[n] = ut;
    w[n] = wt;
    k1 = integrate(this._cf, (sum - wt) / this._totalSum);
  }

  return k1;
};

// The number of values that have been added to this sketch.
proto.size = function() {
  return this._totalSum + this._unmergedSum;
};

// Query for estimated quantile *q*.
// Argument *q* is a desired quantile in the range (0,1)
// For example, q = 0.5 queries for the median.
proto.quantile = function(q) {
  this._mergeValues();
  q = q * this._totalSum;

  var w = this._weight,
      u = this._mean,
      n = this._last,
      max = this._max,
      ua = u[0], ub, // means
      wa = w[0], wb, // weights
      left = this._min, right,
      sum = 0, p, i;

  if (n === 0) return w[n] === 0 ? NaN : u[0];
  if (w[n] > 0) ++n;

  for (i=1; i<n; ++i) {
    ub = u[i];
    wb = w[i];
    right = (wb * ua + wa * ub) / (wa + wb);

    if (q < sum + wa) {
      p = (q - sum) / wa;
      return left * (1-p) + right * p;
    }

    sum += wa;
    ua = ub;
    wa = wb;
    left = right;
  }

  right = max;
  if (q < sum + wa) {
    p = (q - sum) / wa;
    return left * (1-p) + right * p;
  } else {
    return max;
  }
};

// Query for fraction of values <= *v*.
proto.cdf = function(v) {
  this._mergeValues();

  var total = this._totalSum,
      w = this._weight,
      u = this._mean,
      n = this._last,
      min = this._min,
      max = this._max,
      ua = min, ub, // means
      wa = 0,   wb, // weights
      sum = 0, left = 0, right, i;

  if (n === 0) {
    return w[n] === 0 ? NaN :
      v < min ? 0 :
      v > max ? 1 :
      (max - min < EPSILON) ? 0.5 :
      interpolate(v, min, max);
  }
  if (w[n] > 0) ++n;

  // find enclosing pair of centroids (treat min as a virtual centroid)
  for (i=0; i<n; ++i) {
    ub = u[i];
    wb = w[i];
    right = (ub - ua) * wa / (wa + wb);

    // we know that v >= ua-left
    if (v < ua + right) {
      v = (sum + wa * interpolate(v, ua-left, ua+right)) / total;
      return v > 0 ? v : 0;
    }

    sum += wa;
    left = ub - (ua + right);
    ua = ub;
    wa = wb;
  }

  // for the last element, use max to determine right
  right = max - ua;
  return  (v < ua + right) ?
    (sum + wa * interpolate(v, ua-left, ua+right)) / total :
    1;
};

// Union this t-digest with another.
proto.union = function(td) {
  var u = TDigest.import(this.export());
  td._mergeValues();
  for (var i=0, n=td._last; i<n; ++i) {
    u.add(td._mean[i], td._weight[i]);
  }
  return u;
};

// Return a JSON-compatible serialized version of this sketch.
proto.export = function() {
  this._mergeValues();
  return {
    compress: this._cf,
    min:      this._min,
    max:      this._max,
    mean:     [].slice.call(this._mean, 0, this._last+1),
    weight:   [].slice.call(this._weight, 0, this._last+1)
  };
};

module.exports = TDigest;
