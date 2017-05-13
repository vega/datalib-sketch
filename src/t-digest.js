// T-Digests are a sketch for quantile and cdf estimation.
// Similar in spirit to a 1D k-means, the t-digest fits a bounded set of
// centroids to streaming input to learn a variable-width histogram.
// See: 'Computing Extremely Accurate Quantiles using t-Digests'
// by T. Dunning & O. Ertl.
// Based on the Ted Dunning's merging digest implementation at:
// https://github.com/tdunning/t-digest
// One major departure from the reference implementation is the use of
// a binary search to speed up quantile and cdf queries.

var arrays = require('./arrays');

var EPSILON = 1e-300,
    DEFAULT_CENTROIDS = 100;

// Create a new t-digest sketch for quantile and histogram estimation.
// Argument *n* is the approximate number of centroids, defaults to 100.
function TDigest(n) {
  this._nc = n || DEFAULT_CENTROIDS;

  // Why this size? See https://github.com/vega/datalib-sketch/issues/3
  var size = 2 * Math.ceil(this._nc);

  this._totalSum = 0;
  this._last = 0;
  this._weight = arrays.floats(size);
  this._mean = arrays.floats(size);
  this._min = Number.MAX_VALUE;
  this._max = -Number.MAX_VALUE;

  // double buffer to simplify merge operations
  // _mergeWeight also used for transient storage of cumulative weights
  this._mergeWeight = arrays.floats(size);
  this._mergeMean = arrays.floats(size);

  // temporary buffers for recently added values
  var tempsize = numTemp(this._nc);
  this._unmergedSum = 0;
  this._tempLast = 0;
  this._tempWeight = arrays.floats(tempsize);
  this._tempMean = arrays.floats(tempsize);
  this._order = []; // for sorting
}

// Given the number of centroids, determine temp buffer size
// Perform binary search to find value k such that N = k log2 k
// This should give us good amortized asymptotic complexity
function numTemp(N) {
  var lo = 1, hi = N, mid;
  while (lo < hi) {
    mid = lo + hi >>> 1;
    if (N > mid * Math.log(mid) / Math.LN2) { lo = mid + 1; }
    else { hi = mid; }
  }
  return lo;
}

// Create a new t-digest sketch from a serialized object.
TDigest.import = function(obj) {
  var td = new TDigest();

  td._nc = obj.nc;
  td._totalSum = obj.totalSum;
  td._last = obj.last;
  td._weight = arrays.floats(obj.weight);
  td._mean = arrays.floats(obj.mean);
  td._min = obj.min;
  td._max = obj.max;
  td._mergeWeight = arrays.floats(obj.mergeWeight);
  td._mergeMean = arrays.floats(obj.mergeMean);
  td._unmergedSum = obj.unmergedSum;
  td._tempLast = obj.tempLast;
  td._tempWeight = arrays.floats(obj.tempWeight);
  td._tempMean = arrays.floats(obj.tempMean);
  td._order = obj.order;

  return td;
};

var proto = TDigest.prototype;

// -- Construction Methods -----

// Add a value to the t-digest.
// Argument *v* is the value to add.
// Argument *count* is the integer number of occurrences to add.
// If not provided, *count* defaults to 1.
proto.add = function(v, count) {
  if (v == null || v !== v) return; // ignore null, NaN
  count = count == null ? 1 : count;
  if (count <= 0) throw new Error('Count must be greater than zero.');

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

  // get sort order for added values in temp buffers
  order.length = tn;
  for (i=0; i<tn; ++i) order[i] = i;
  order.sort(function(a,b) { return tu[a] - tu[b]; });

  if (this._totalSum > 0) n = this._last + 1;
  this._last = 0;
  this._totalSum += this._unmergedSum;
  this._unmergedSum = 0;

  // merge existing centroids with added values in temp buffers
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
  // only temp buffer values remain
  for (; i < tn; ++i) {
    ii = order[i];
    sum += tw[ii];
    k1 = this._mergeCentroid(sum, k1, tw[ii], tu[ii]);
  }
  // only existing centroids remain
  for (; j < n; ++j) {
    sum += w[j];
    k1 = this._mergeCentroid(sum, k1, w[j], u[j]);
  }
  this._tempLast = 0;

  // swap pointers for working space and merge space
  this._weight = this._mergeWeight;
  this._mergeWeight = w;
  this._mean = this._mergeMean;
  this._mergeMean = u;

  u[0] = this._weight[0];
  for (i=1, n=this._last, w[0]=0; i<=n; ++i) {
    w[i] = 0; // zero out merge weights
    u[i] = u[i-1] + this._weight[i]; // stash cumulative dist
  }
  this._min = Math.min(this._min, this._mean[0]);
  this._max = Math.max(this._max, this._mean[n]);
};

proto._mergeCentroid = function(sum, k1, wt, ut) {
  var w = this._mergeWeight,
      u = this._mergeMean,
      n = this._last,
      k2 = integrate(this._nc, sum / this._totalSum);

  if (k2 - k1 <= 1 || w[n] === 0) {
    // merge into existing centroid if centroid index difference (k2-k1)
    // is within 1 or if current centroid is empty
    w[n] += wt;
    u[n] += (ut - u[n]) * wt / w[n];
  } else {
    // otherwise create a new centroid
    this._last = ++n;
    u[n] = ut;
    w[n] = wt;
    k1 = integrate(this._nc, (sum - wt) / this._totalSum);
  }

  return k1;
};

// Converts a quantile into a centroid index value. The centroid index is
// nominally the number k of the centroid that a quantile point q should
// belong to. Due to round-offs, however, we can't align things perfectly
// without splitting points and centroids. We don't want to do that, so we
// have to allow for offsets.
// In the end, the criterion is that any quantile range that spans a centroid
// index range more than one should be split across more than one centroid if
// possible. This won't be possible if the quantile range refers to a single
// point or an already existing centroid.
// We use the arcsin function to map from the quantile domain to the centroid
// index range. This produces a mapping that is steep near q=0 or q=1 so each
// centroid there will correspond to less q range. Near q=0.5, the mapping is
// flatter so that centroids there will represent a larger chunk of quantiles.
function integrate(nc, q) {
  // First, scale and bias the quantile domain to [-1, 1]
  // Next, bias and scale the arcsin range to [0, 1]
  // This gives us a [0,1] interpolant following the arcsin shape
  // Finally, multiply by centroid count for centroid scale value
  return nc * (Math.asin(2 * q - 1) + Math.PI/2) / Math.PI;
}

// -- Query Methods -----

// The number of values that have been added to this sketch.
proto.size = function() {
  return this._totalSum + this._unmergedSum;
};

// Query for estimated quantile *q*.
// Argument *q* is a desired quantile in the range (0,1)
// For example, q = 0.5 queries for the median.
proto.quantile = function(q) {
  this._mergeValues();

  var total = this._totalSum,
      n = this._last,
      u = this._mean,
      w = this._weight,
      c = this._mergeMean,
      i, l, r, min, max;

  l = min = this._min;
  r = max = this._max;
  if (total === 0) return NaN;
  if (q <= 0) return min;
  if (q >= 1) return max;
  if (n === 0) return u[0];

  // calculate boundaries, pick centroid via binary search
  q = q * total;
  i = bisect(c, q, 0, n+1);
  if (i > 0) l = boundary(i-1, i, u, w);
  if (i < n) r = boundary(i, i+1, u, w);
  return l + (r-l) * (q - (c[i-1]||0)) / w[i];
};

// Query the estimated cumulative distribution function.
// In other words, query for the fraction of values <= *v*.
proto.cdf = function(v) {
  this._mergeValues();

  var total = this._totalSum,
      n = this._last,
      u = this._mean,
      w = this._weight,
      c = this._mergeMean,
      i, l, r, min, max;

  l = min = this._min;
  r = max = this._max;
  if (total === 0) return NaN;
  if (v < min) return 0;
  if (v > max) return 1;
  if (n === 0) return interp(v, min, max);

  // calculate boundaries, pick start point via binary search
  i = bisect(u, v, 0, n+1);
  if (i > 0) l = boundary(i-1, i, u, w);
  if (i < n) r = boundary(i, i+1, u, w);
  if (v < l) { // shift one interval if value exceeds boundary
    r = l;
    l = --i ? boundary(i-1, i, u, w) : min;
  }
  return ((c[i-1]||0) + w[i] * interp(v, l, r)) / total;
};

function bisect(a, x, lo, hi) {
  while (lo < hi) {
    var mid = lo + hi >>> 1;
    if (a[mid] < x) { lo = mid + 1; }
    else { hi = mid; }
  }
  return lo;
}

function boundary(i, j, u, w) {
  return u[i] + (u[j] - u[i]) * w[i] / (w[i] + w[j]);
}

function interp(x, x0, x1) {
  var denom = x1 - x0;
  return denom > EPSILON ? (x - x0) / denom : 0.5;
}

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
proto.export = function () {
  return {
    nc: this._nc,
    totalSum: this._totalSum,
    last: this._last,
    weight: Array.prototype.slice.call(this._weight),
    mean: Array.prototype.slice.call(this._mean),
    min: this._min,
    max: this._max,
    mergeWeight: Array.prototype.slice.call(this._mergeWeight),
    mergeMean: Array.prototype.slice.call(this._mergeMean),
    unmergedSum: this._unmergedSum,
    tempLast: this._tempLast,
    tempWeight: Array.prototype.slice.call(this._tempWeight),
    tempMean: Array.prototype.slice.call(this._tempMean),
    order: this._order
  };
};

module.exports = TDigest;
