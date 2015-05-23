// Count-Mean-Min sketches extend Count-Min with improved estimation.
// See 'New Estimation Algorithms for Streaming Data: Count-min Can Do More'
// by Deng & Rafiei, http://webdocs.cs.ualberta.ca/~fandeng/paper/cmm.pdf

var CountMin = require('./count-min');

// Create a new Count-Mean-Min sketch.
// If argument *w* is an array-like object, with a length property, then the
// sketch is loaded with data from the array, each element is a 32-bit integer.
// Otherwise, *w* specifies the width (number of row entries) of the sketch.
// Argument *d* specifies the depth (number of hash functions) of the sketch.
// Argument *num* indicates the number of elements add. This should only be
// provided if *w* is an array, in which case *num* is required.
function CountMeanMin(w, d, num) {
  CountMin.call(this, w, d, num);
  this._q = Array(d);
}

// Create a new Count-Min sketch based on provided performance parameters.
// Argument *n* is the expected count of all elements
// Argument *e* is the acceptable absolute error.
// Argument *p* is the probability of not achieving the error bound.
CountMeanMin.create = CountMin.create;

// Create a new Count-Mean-Min sketch from a serialized object.
CountMeanMin.import = CountMin.import;

var proto = (CountMeanMin.prototype = Object.create(CountMin.prototype));

// Query for approximate count.
proto.query = function(v) {
  var l = this.locations(v + ''),
      t = this._table,
      q = this._q,
      w = this._w,
      d = this._d,
      n = this._num,
      s = 1 / (w-1),
      min = +Infinity, c, i, r;

  for (i=0, r=0; i<d; ++i, r+=w) {
    c = t[r + l[i]];
    if (c < min) min = c;
    c = c - (n-c) * s;
    q[i] = c;
  }

  return (c = median(q)) < 0 ? 0 : c > min ? min : c;
};

// Approximate dot product with another sketch.
// The input sketch must have the same depth and width.
// Otherwise, this method will throw an error.
proto.dot = function(that) {
  if (this._w !== that._w) throw 'Sketch widths do not match.';
  if (this._d !== that._d) throw 'Sketch depths do not match.';

  var ta = this._table,
      tb = that._table,
      q = this._q,
      w = this._w,
      n = this._num,
      m = this._d * w,
      z = (w - 1) / w,
      s = 1 / (w-1),
      dot = 0, i = 0;

  do {
    dot += (ta[i] - (n-ta[i])*s) * (tb[i] - (n-tb[i])*s);
    if (++i % w === 0) {
      q[i/w-1] = z * dot;
      dot = 0;
    }
  } while (i < m);

  return (dot = median(q)) < 0 ? 0 : dot;
};

function median(q) {
  q.sort(numcmp);
  var n = q.length,
      h = ~~(n/2);
  return n % 2 ? q[h] : 0.5 * (q[h-1] + q[h]);
}

function numcmp(a, b) {
  return a - b;
}

module.exports = CountMeanMin;
