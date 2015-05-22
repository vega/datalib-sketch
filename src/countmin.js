var hash = require('./hash');

var TYPED_ARRAYS = typeof ArrayBuffer !== "undefined",
    DEFAULT_BINS = 1021,
    DEFAULT_HASH = 3;

function CountMin(w, d) {
  this._w = w || DEFAULT_BINS;
  this._d = d || DEFAULT_HASH;
  this._num = 0;
  
  if (TYPED_ARRAYS) {
    this._table = new Int32Array(d*w);
  } else {
    var i = -1, n = d*w;
    this._table = Array(n);
    while (++i < n) this._table[i] = 0;
  }
  hash.init.call(this);
}

CountMin.create = function(accuracy, probability) {
  accuracy = accuracy || 0.1;
  probability = probability || 0.0001;
  var d = Math.ceil(-Math.log(probability)) | 0,
      w = Math.ceil(Math.E / accuracy) | 0;
  return new this(w, d);
};

var proto = CountMin.prototype;

proto.locations = hash.locations;

// Add a value to the sketch.
proto.add = function(value) {
  var l = this.locations(value),
      t = this._table,
      w = this._w,
      d = this._d, i;
  for (i=0; i<d; ++i) {
    t[i*w + l[i]] += 1;
  }
  this._num += 1;
};

// Query for approximate count.
proto.query = function(value) {
  var min = +Infinity,
      l = this.locations(value),
      t = this._table,
      w = this._w,
      d = this._d, i, r, v;
  for (i=0, r=0; i<d; ++i, r+=w) {
    v = t[r + l[i]];
    if (v < min) min = v;
  }
  return min;
};

// Approximate dot product with another sketch.
// The input sketch must have the same depth and width.
// Otherwise, this method will throw an error.
proto.dot = function(that) {
  if (this._w !== that._w) throw 'Sketch widths do not match.';
  if (this._d !== that._d) throw 'Sketch depths do not match.';

  var ta = this._table,
      tb = that._table,
      w = this._w,
      m = this._d * w,
      min = +Infinity,
      dot = 0, i = 0;

  do {
    dot += ta[i] * tb[i];
    if (++i % w === 0) {
      if (dot < min) min = dot;
      dot = 0;
    }
  } while (i < m);

  return min;
};

module.exports = CountMin;
