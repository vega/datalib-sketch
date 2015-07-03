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
  tempsize = ~~(7.5 + 0.37*cf - 2e-4 * cf * cf);
  // should only need ceil(cf * PI / 2), double allocation for safety
  size = ~~(Math.PI * cf + 0.5);
  
  this._cf = cf;

  this._totalWeight = 0;
  this._weight = numArray(size);
  this._mean = numArray(size);
  this._min = Number.MAX_VALUE;
  this._max = -Number.MAX_VALUE;

  this._unmergedWeight = 0;
  this._mergeWeight = numArray(size);
  this._mergeMean = numArray(size);

  this._tempUsed = 0;
  this._tempWeight = numArray(tempsize);
  this._tempMean = numArray(tempsize);
  this._order = [];
  
  this._lastUsed = 0;
}

function numArray(size) {
  return TYPED_ARRAYS ? new Float64Array(size) : Array(size);
}

function interpolate(x, x0, x1) {
  return (x - x0) / (x1 - x0);
}

// Create a new t-digest sketch from a serialized object.
TDigest.import = function(obj) {
  var td = new TDigest(obj.compress);
  td._min = obj.min;
  td._max = obj.max;
  td._lastUsed = obj.mean.length;
  for (var i=0, n=obj.mean.length; i<n; ++i) {
    td._mean[i] = obj.mean[i];
    td._weight[i] = obj.weight[i];
  }
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
  
  if (this._tempUsed >= this._tempWeight.length) {
    this._mergeValues();
  }

  var where = this._tempUsed++;
  this._tempWeight[where] = count;
  this._tempMean[where] = v;
  this._unmergedWeight += count;
};

proto._mergeValues = function() {
  if (this._unmergedWeight === 0) return;
  // var m = [], w = [];
  // for (var mm=0; mm<this._tempUsed; ++mm) {
  //   m.push(this._tempMean[mm]);
  //   w.push(this._tempWeight[mm]);
  // }
  // console.log('MERGE', this._tempUsed, m, w);

  var tempWeight = this._tempWeight,
      tempMean = this._tempMean,
      tempUsed = this._tempUsed,
      weight = this._weight,
      mean = this._mean,
      order = this._order,
      wSoFar = 0, n = 0, i, j, k1, ix;

  // get sort order for temp values
  // TODO make more efficient?
  order.length = tempUsed;
  for (i=0; i<tempUsed; ++i) {
    order[i] = i;
  }
  order.sort(function(a,b) {
    return tempMean[a] - tempMean[b];
  });

  if (this._totalWeight > 0) {
    if (weight[this._lastUsed] > 0) {
      n = this._lastUsed + 1;
    } else {
      n = this._lastUsed;
    }
  }
  this._lastUsed = 0;
  this._totalWeight += this._unmergedWeight;
  this._unmergedWeight = 0;

  // merge tempWeight,tempMean and weight,mean into mergeWeight,mergeMean
  for (i=j=k1=0; i < tempUsed && j < n;) {
    ix = order[i];
    if (tempMean[ix] <= mean[j]) {
      wSoFar += tempWeight[ix];
      k1 = this._mergeCentroid(wSoFar, k1, tempWeight[ix], tempMean[ix]);
      i++;
    } else {
      wSoFar += weight[j];
      k1 = this._mergeCentroid(wSoFar, k1, weight[j], mean[j]);
      j++;
    }
  }

  while (i < tempUsed) {
    ix = order[i];
    wSoFar += tempWeight[ix];
    k1 = this._mergeCentroid(wSoFar, k1, tempWeight[ix], tempMean[ix]);
    i++;
  }

  while (j < n) {
    wSoFar += weight[j];
    k1 = this._mergeCentroid(wSoFar, k1, weight[j], mean[j]);
    j++;
  }
  this._tempUsed = 0;

  // var m = [], w = [];
  // for (var mm=0; mm<=this._lastUsed; ++mm) {
  //   m.push(this._mergeMean[mm]);
  //   w.push(this._mergeWeight[mm]);
  // }
  // console.log('MERGE', this._lastUsed, m, w);


  // swap pointers for working space and merge space
  this._weight = this._mergeWeight;
  this._mergeWeight = weight;
  for (i=0, n=weight.length; i<n; ++i) {
    weight[i] = 0;
  }

  this._mean = this._mergeMean;
  this._mergeMean = mean;

  if (this._totalWeight > 0) {
    this._min = Math.min(this._min, this._mean[0]);
    if (this._weight[this._lastUsed] > 0) {
      this._max = Math.max(this._max, this._mean[this._lastUsed]);
    } else {
      this._max = Math.max(this._max, this._mean[this._lastUsed - 1]);
    }
  }
};

proto._mergeCentroid = function(wSoFar, k1, w, m) {
  var mergeWeight = this._mergeWeight,
      mergeMean = this._mergeMean,
      lastUsed = this._lastUsed;

  var k2 = this._integrate(wSoFar / this._totalWeight);
  if (k2 - k1 <= 1 || mergeWeight[this._lastUsed] === 0) {
    // merge into existing centroid
    mergeWeight[lastUsed] += w;
    mergeMean[lastUsed] = mergeMean[lastUsed] +
      (m - mergeMean[lastUsed]) * w / mergeWeight[lastUsed];
  } else {
    // create new centroid
    this._lastUsed = ++lastUsed;
    mergeMean[lastUsed] = m;
    mergeWeight[lastUsed] = w;
    k1 = this._integrate((wSoFar - w) / this._totalWeight);
  }

  return k1;
};

proto._integrate = function(q) {
  return this._cf * (Math.asin(2 * q - 1) + Math.PI / 2) / Math.PI;
};

// The number of values that have been added to this sketch.
proto.size = function() {
  return this._totalWeight + this._unmergedWeight;
};

// Query for estimated quantile *q*.
// Argument *q* is a desired quantile in the range (0,1)
// For example, q = 0.5 queries for the median.
proto.quantile = function(q) {
  this._mergeValues();
  var weight = this._weight,
      mean = this._mean,
      n = this._lastUsed;

  if (n === 0) return weight[n] === 0 ? NaN : mean[0];
  if (weight[n] > 0) ++n;

  var index = q * this._totalWeight,
      weightSoFar = 0,
      left = this._min,
      a = mean[0],
      aCount = weight[0],
      right, b, bCount, p, i;

  for (i=1; i<n; ++i) {
    b = mean[i];
    bCount = weight[i];
    right = (bCount * a + aCount * b) / (aCount + bCount);
    if (index < weightSoFar + aCount) {
      p = (index - weightSoFar) / aCount;
      return left * (1 - p) + right * p;
    }

    weightSoFar += aCount;
    a = b;
    aCount = bCount;
    left = right;
  }

  right = this._max;
  if (index < weightSoFar + aCount) {
    p = (index - weightSoFar) / aCount;
    return left * (1 - p) + right * p;
  } else {
    return this._max;
  }
};

// Query for fraction of values <= *v*.
proto.cdf = function(v) {
  this._mergeValues();

  var weight = this._weight,
      mean = this._mean,
      n = this._lastUsed,
      min = this._min,
      max = this._max;

  if (v < min) return 0;
  if (v > max) return 1;
  if (n === 0) {
    return weight[n] === 0 ? NaN :
      (max - min < EPSILON) ? 0.5 :
      interpolate(v, min, max);
  }

  if (weight[n] > 0) ++n;

  var total = this._totalWeight,
      r = 0,
      a = min,
      b = min,
      aCount = 0,
      bCount = 0,
      left = 0,
      right = 0, i;

  // find enclosing pair of centroids (treat min as a virtual centroid)
  for (i=0; i<n; ++i) {
    left = b - (a + right);
    a = b;
    aCount = bCount;

    b = mean[i];
    bCount = weight[i];
    right = (b - a) * aCount / (aCount + bCount);

    // we know that x >= a-left
    if (v < a + right) {
      v = (r + aCount * interpolate(v, a-left, a+right)) / total;
      return v > 0 ? v : 0;
    }

    r += aCount;
  }

  left = b - (a + right);
  a = b;
  aCount = bCount;
  right = max - a;

  // for the last element, use max to determine right
  return  (v < a + right) ?
    (r + aCount * interpolate(v, a-left, a+right)) / total :
    1;
};

// Return a JSON-compatible serialized version of this sketch.
proto.export = function() {
  var n = this._lastUsed, i,
      m = Array(n),
      w = Array(n);

  for (i=0; i<n; ++i) {
    m[i] = this._mean[i];
    w[i] = this._weight[i];
  }
  
  return {
    compress: this._cf,
    min: this._min,
    max: this._max,
    mean: m,
    weight: w
  };
};

module.exports = TDigest;
