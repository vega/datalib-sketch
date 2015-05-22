(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}(g.dl || (g.dl = {})).sketch = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = {
  bloom:        require('./bloom'),
  countmin:     require('./count-min'),
  countmeanmin: require('./count-mean-min')
};
},{"./bloom":2,"./count-mean-min":3,"./count-min":4}],2:[function(require,module,exports){
// Bloom Filter implementation. Heavily based on:
// https://github.com/jasondavies/bloomfilter.js
var hash = require('./hash');

var TYPED_ARRAYS = typeof ArrayBuffer !== "undefined",
    DEFAULT_BITS = 1024 * 64,
    DEFAULT_HASH = 3;

// Creates a new bloom filter. If *w* is an array-like object, with a length
// property, then the bloom filter is loaded with data from the array, where
// each element is a 32-bit integer. Otherwise, *w* should specify the width
// of the filter in bits. Note that *w* is rounded up to the nearest multiple
// of 32. *d* (the filter depth) specifies the number of hash functions.
function BloomFilter(w, d) {
  w = w || DEFAULT_BITS;
  d = d || DEFAULT_HASH;

  var a;
  if (typeof w !== "number") { a = w; w = a.length * 32; }

  var n = Math.ceil(w / 32),
      i = -1, buckets;
  this._w = w = n * 32;
  this._d = d;

  if (TYPED_ARRAYS) {
    buckets = this._buckets = new Int32Array(n);
    if (a) while (++i < n) buckets[i] = a[i];
  } else {
    buckets = this._buckets = [];
    if (a) while (++i < n) buckets[i] = a[i];
    else while (++i < n) buckets[i] = 0;
  }
  hash.init.call(this);
}

var proto = BloomFilter.prototype;

proto.locations = hash.locations;

// Add a value to the filter.
proto.add = function(v) {
  var l = this.locations(v + ""),
      i = -1,
      d = this._d,
      buckets = this._buckets;
  while (++i < d) buckets[Math.floor(l[i] / 32)] |= 1 << (l[i] % 32);
};

// Query for inclusion in the filter.
proto.query = function(v) {
  var l = this.locations(v + ""),
      i = -1,
      d = this._d,
      b,
      buckets = this._buckets;
  while (++i < d) {
    b = l[i];
    if ((buckets[Math.floor(b / 32)] & (1 << (b % 32))) === 0) {
      return false;
    }
  }
  return true;
};

// Estimated cardinality.
proto.size = function() {
  var buckets = this._buckets,
      bits = 0, i, n;
  for (i=0, n=buckets.length; i<n; ++i) bits += bitcount(buckets[i]);
  return -this._w * Math.log(1 - bits / this._w) / this._d;
};

// Union this bloom filter with another.
// The input filter must have the same depth and width.
// Otherwise, this method will throw an error.
proto.union = function(bf) {
  if (bf._w !== this._w) throw 'Filter widths do not match.';
  if (bf._d !== this._d) throw 'Filter depths do not match.';

  var a = this._buckets,
      b = bf._buckets,
      n = a.length,
      z = TYPED_ARRAYS ? new Int32Array(n) : Array(n),
      i;

  for (i=0; i<n; ++i) {
    z[i] = a[i] | b[i];
  }
  return new BloomFilter(z, this._d);
};

// Jaccard co-efficient of two bloom filters.
// The input filter must have the same size and hash count.
// Otherwise, this method will throw an error.
proto.jaccard = function(bf) {
  if (bf._w !== this._w) throw 'Filter widths do not match.';
  if (bf._d !== this._d) throw 'Filter depths do not match.';

  var a = this._buckets,
      b = bf._buckets,
      n = a.length,
      x, y, z, i;

  for (i=x=y=z=0; i<n; ++i) {
    x += bitcount(a[i]);
    y += bitcount(b[i]);
    z += bitcount(a[i] | b[i]);
  }
  x = Math.log(1 - x / this._w);
  y = Math.log(1 - y / this._w);
  z = Math.log(1 - z / this._w);
  return (x + y) / z - 1;
};

// Construct a new filter from a serialized object.
proto.import = function(obj) {
  return new BloomFilter(obj.bits, obj.depth);
};

// Return a JSON-compatible serialized version of this filter.
proto.export = function() {
  return {
    depth: this._d,
    bits: [].slice.call(this._buckets)
  };
};

// http://graphics.stanford.edu/~seander/bithacks.html#CountBitsSetParallel
function bitcount(v) {
  v -= (v >> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return ((v + (v >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

module.exports = BloomFilter;
},{"./hash":5}],3:[function(require,module,exports){
var CountMin = require('./count-min');

// Count-Mean-Min sketch extends Count-Min with improved estimation.
// See 'New Estimation Algorithms for Streaming Data: Count-min Can Do More'
// by Deng & Rafiei, http://webdocs.cs.ualberta.ca/~fandeng/paper/cmm.pdf
// Argument *w* specifies the width (number of row entries) of the sketch.
// Argument *d* specifies the depth (number of hash functions) of the sketch.
function CountMeanMin(w, d) {
  CountMin.call(this, w, d);
  this._q = Array(d);
}

CountMeanMin.create = CountMin.create;

var proto = (CountMeanMin.prototype = Object.create(CountMin.prototype));

// Query for approximate count.
proto.query = function(value) {
  var l = this.locations(value),
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

},{"./count-min":4}],4:[function(require,module,exports){
var hash = require('./hash');

var TYPED_ARRAYS = typeof ArrayBuffer !== "undefined",
    DEFAULT_BINS = 1021,
    DEFAULT_HASH = 3;

// Count-Min sketch for approximate counting of value frequencies.
// See: 'An Improved Data Stream Summary: The Count-Min Sketch and its
// Applications' by G. Cormode & S. Muthukrishnan.
// Argument *w* specifies the width (number of row entries) of the sketch.
// Argument *d* specifies the depth (number of hash functions) of the sketch.
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

},{"./hash":5}],5:[function(require,module,exports){
var TYPED_ARRAYS = typeof ArrayBuffer !== "undefined";

// Fowler/Noll/Vo hashing.
function fnv_1a(v) {
  var n = v.length,
      a = 2166136261,
      c,
      d,
      i = -1;
  while (++i < n) {
    c = v.charCodeAt(i);
    if ((d = c & 0xff000000)) {
      a ^= d >> 24;
      a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
    }
    if ((d = c & 0xff0000)) {
      a ^= d >> 16;
      a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
    }
    if ((d = c & 0xff00)) {
      a ^= d >> 8;
      a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
    }
    a ^= c & 0xff;
    a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
  }
  // From http://home.comcast.net/~bretm/hash/6.html
  a += a << 13;
  a ^= a >> 7;
  a += a << 3;
  a ^= a >> 17;
  a += a << 5;
  return a & 0xffffffff;
}

// One additional iteration of FNV, given a hash.
function fnv_1a_b(a) {
  a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
  a += a << 13;
  a ^= a >> 7;
  a += a << 3;
  a ^= a >> 17;
  a += a << 5;
  return a & 0xffffffff;
}

// mix-in method for multi-hash initialization
module.exports.init = function() {
  var d = this._d,
      w = this._w;

  if (TYPED_ARRAYS) {
    var kbytes = 1 << Math.ceil(Math.log(
          Math.ceil(Math.log(w) / Math.LN2 / 8)
        ) / Math.LN2),
        array = kbytes === 1 ? Uint8Array : kbytes === 2 ? Uint16Array : Uint32Array,
        kbuffer = new ArrayBuffer(kbytes * d);
    this._locations = new array(kbuffer);
  } else {
    this._locations = [];
  }
};

// mix-in method for multi-hash calculation
// See http://willwhim.wordpress.com/2011/09/03/producing-n-hash-functions-by-hashing-only-once/
module.exports.locations = function(v) {
  var d = this._d,
      w = this._w,
      r = this._locations,
      a = fnv_1a(v),
      b = fnv_1a_b(a),
      i = -1,
      x = a % w;
  while (++i < d) {
    r[i] = x < 0 ? (x + w) : x;
    x = (x + b) % w;
  }
  return r;
};

module.exports.fnv_1a = fnv_1a;
module.exports.fnv_1a_b = fnv_1a_b;

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMiLCJzcmMvYmxvb20uanMiLCJzcmMvY291bnQtbWVhbi1taW4uanMiLCJzcmMvY291bnQtbWluLmpzIiwic3JjL2hhc2guanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0ge1xuICBibG9vbTogICAgICAgIHJlcXVpcmUoJy4vYmxvb20nKSxcbiAgY291bnRtaW46ICAgICByZXF1aXJlKCcuL2NvdW50LW1pbicpLFxuICBjb3VudG1lYW5taW46IHJlcXVpcmUoJy4vY291bnQtbWVhbi1taW4nKVxufTsiLCIvLyBCbG9vbSBGaWx0ZXIgaW1wbGVtZW50YXRpb24uIEhlYXZpbHkgYmFzZWQgb246XG4vLyBodHRwczovL2dpdGh1Yi5jb20vamFzb25kYXZpZXMvYmxvb21maWx0ZXIuanNcbnZhciBoYXNoID0gcmVxdWlyZSgnLi9oYXNoJyk7XG5cbnZhciBUWVBFRF9BUlJBWVMgPSB0eXBlb2YgQXJyYXlCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIsXG4gICAgREVGQVVMVF9CSVRTID0gMTAyNCAqIDY0LFxuICAgIERFRkFVTFRfSEFTSCA9IDM7XG5cbi8vIENyZWF0ZXMgYSBuZXcgYmxvb20gZmlsdGVyLiBJZiAqdyogaXMgYW4gYXJyYXktbGlrZSBvYmplY3QsIHdpdGggYSBsZW5ndGhcbi8vIHByb3BlcnR5LCB0aGVuIHRoZSBibG9vbSBmaWx0ZXIgaXMgbG9hZGVkIHdpdGggZGF0YSBmcm9tIHRoZSBhcnJheSwgd2hlcmVcbi8vIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLiBPdGhlcndpc2UsICp3KiBzaG91bGQgc3BlY2lmeSB0aGUgd2lkdGhcbi8vIG9mIHRoZSBmaWx0ZXIgaW4gYml0cy4gTm90ZSB0aGF0ICp3KiBpcyByb3VuZGVkIHVwIHRvIHRoZSBuZWFyZXN0IG11bHRpcGxlXG4vLyBvZiAzMi4gKmQqICh0aGUgZmlsdGVyIGRlcHRoKSBzcGVjaWZpZXMgdGhlIG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucy5cbmZ1bmN0aW9uIEJsb29tRmlsdGVyKHcsIGQpIHtcbiAgdyA9IHcgfHwgREVGQVVMVF9CSVRTO1xuICBkID0gZCB8fCBERUZBVUxUX0hBU0g7XG5cbiAgdmFyIGE7XG4gIGlmICh0eXBlb2YgdyAhPT0gXCJudW1iZXJcIikgeyBhID0gdzsgdyA9IGEubGVuZ3RoICogMzI7IH1cblxuICB2YXIgbiA9IE1hdGguY2VpbCh3IC8gMzIpLFxuICAgICAgaSA9IC0xLCBidWNrZXRzO1xuICB0aGlzLl93ID0gdyA9IG4gKiAzMjtcbiAgdGhpcy5fZCA9IGQ7XG5cbiAgaWYgKFRZUEVEX0FSUkFZUykge1xuICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzID0gbmV3IEludDMyQXJyYXkobik7XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gYVtpXTtcbiAgfSBlbHNlIHtcbiAgICBidWNrZXRzID0gdGhpcy5fYnVja2V0cyA9IFtdO1xuICAgIGlmIChhKSB3aGlsZSAoKytpIDwgbikgYnVja2V0c1tpXSA9IGFbaV07XG4gICAgZWxzZSB3aGlsZSAoKytpIDwgbikgYnVja2V0c1tpXSA9IDA7XG4gIH1cbiAgaGFzaC5pbml0LmNhbGwodGhpcyk7XG59XG5cbnZhciBwcm90byA9IEJsb29tRmlsdGVyLnByb3RvdHlwZTtcblxucHJvdG8ubG9jYXRpb25zID0gaGFzaC5sb2NhdGlvbnM7XG5cbi8vIEFkZCBhIHZhbHVlIHRvIHRoZSBmaWx0ZXIuXG5wcm90by5hZGQgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModiArIFwiXCIpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBidWNrZXRzID0gdGhpcy5fYnVja2V0cztcbiAgd2hpbGUgKCsraSA8IGQpIGJ1Y2tldHNbTWF0aC5mbG9vcihsW2ldIC8gMzIpXSB8PSAxIDw8IChsW2ldICUgMzIpO1xufTtcblxuLy8gUXVlcnkgZm9yIGluY2x1c2lvbiBpbiB0aGUgZmlsdGVyLlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModiArIFwiXCIpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBiLFxuICAgICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHM7XG4gIHdoaWxlICgrK2kgPCBkKSB7XG4gICAgYiA9IGxbaV07XG4gICAgaWYgKChidWNrZXRzW01hdGguZmxvb3IoYiAvIDMyKV0gJiAoMSA8PCAoYiAlIDMyKSkpID09PSAwKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXN0aW1hdGVkIGNhcmRpbmFsaXR5LlxucHJvdG8uc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiaXRzID0gMCwgaSwgbjtcbiAgZm9yIChpPTAsIG49YnVja2V0cy5sZW5ndGg7IGk8bjsgKytpKSBiaXRzICs9IGJpdGNvdW50KGJ1Y2tldHNbaV0pO1xuICByZXR1cm4gLXRoaXMuX3cgKiBNYXRoLmxvZygxIC0gYml0cyAvIHRoaXMuX3cpIC8gdGhpcy5fZDtcbn07XG5cbi8vIFVuaW9uIHRoaXMgYmxvb20gZmlsdGVyIHdpdGggYW5vdGhlci5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLnVuaW9uID0gZnVuY3Rpb24oYmYpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB6ID0gVFlQRURfQVJSQVlTID8gbmV3IEludDMyQXJyYXkobikgOiBBcnJheShuKSxcbiAgICAgIGk7XG5cbiAgZm9yIChpPTA7IGk8bjsgKytpKSB7XG4gICAgeltpXSA9IGFbaV0gfCBiW2ldO1xuICB9XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIoeiwgdGhpcy5fZCk7XG59O1xuXG4vLyBKYWNjYXJkIGNvLWVmZmljaWVudCBvZiB0d28gYmxvb20gZmlsdGVycy5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIHNpemUgYW5kIGhhc2ggY291bnQuXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5qYWNjYXJkID0gZnVuY3Rpb24oYmYpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB4LCB5LCB6LCBpO1xuXG4gIGZvciAoaT14PXk9ej0wOyBpPG47ICsraSkge1xuICAgIHggKz0gYml0Y291bnQoYVtpXSk7XG4gICAgeSArPSBiaXRjb3VudChiW2ldKTtcbiAgICB6ICs9IGJpdGNvdW50KGFbaV0gfCBiW2ldKTtcbiAgfVxuICB4ID0gTWF0aC5sb2coMSAtIHggLyB0aGlzLl93KTtcbiAgeSA9IE1hdGgubG9nKDEgLSB5IC8gdGhpcy5fdyk7XG4gIHogPSBNYXRoLmxvZygxIC0geiAvIHRoaXMuX3cpO1xuICByZXR1cm4gKHggKyB5KSAvIHogLSAxO1xufTtcblxuLy8gQ29uc3RydWN0IGEgbmV3IGZpbHRlciBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5wcm90by5pbXBvcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgcmV0dXJuIG5ldyBCbG9vbUZpbHRlcihvYmouYml0cywgb2JqLmRlcHRoKTtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBmaWx0ZXIuXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICBkZXB0aDogdGhpcy5fZCxcbiAgICBiaXRzOiBbXS5zbGljZS5jYWxsKHRoaXMuX2J1Y2tldHMpXG4gIH07XG59O1xuXG4vLyBodHRwOi8vZ3JhcGhpY3Muc3RhbmZvcmQuZWR1L35zZWFuZGVyL2JpdGhhY2tzLmh0bWwjQ291bnRCaXRzU2V0UGFyYWxsZWxcbmZ1bmN0aW9uIGJpdGNvdW50KHYpIHtcbiAgdiAtPSAodiA+PiAxKSAmIDB4NTU1NTU1NTU7XG4gIHYgPSAodiAmIDB4MzMzMzMzMzMpICsgKCh2ID4+IDIpICYgMHgzMzMzMzMzMyk7XG4gIHJldHVybiAoKHYgKyAodiA+PiA0KSAmIDB4RjBGMEYwRikgKiAweDEwMTAxMDEpID4+IDI0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb29tRmlsdGVyOyIsInZhciBDb3VudE1pbiA9IHJlcXVpcmUoJy4vY291bnQtbWluJyk7XG5cbi8vIENvdW50LU1lYW4tTWluIHNrZXRjaCBleHRlbmRzIENvdW50LU1pbiB3aXRoIGltcHJvdmVkIGVzdGltYXRpb24uXG4vLyBTZWUgJ05ldyBFc3RpbWF0aW9uIEFsZ29yaXRobXMgZm9yIFN0cmVhbWluZyBEYXRhOiBDb3VudC1taW4gQ2FuIERvIE1vcmUnXG4vLyBieSBEZW5nICYgUmFmaWVpLCBodHRwOi8vd2ViZG9jcy5jcy51YWxiZXJ0YS5jYS9+ZmFuZGVuZy9wYXBlci9jbW0ucGRmXG4vLyBBcmd1bWVudCAqdyogc3BlY2lmaWVzIHRoZSB3aWR0aCAobnVtYmVyIG9mIHJvdyBlbnRyaWVzKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKmQqIHNwZWNpZmllcyB0aGUgZGVwdGggKG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucykgb2YgdGhlIHNrZXRjaC5cbmZ1bmN0aW9uIENvdW50TWVhbk1pbih3LCBkKSB7XG4gIENvdW50TWluLmNhbGwodGhpcywgdywgZCk7XG4gIHRoaXMuX3EgPSBBcnJheShkKTtcbn1cblxuQ291bnRNZWFuTWluLmNyZWF0ZSA9IENvdW50TWluLmNyZWF0ZTtcblxudmFyIHByb3RvID0gKENvdW50TWVhbk1pbi5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKENvdW50TWluLnByb3RvdHlwZSkpO1xuXG4vLyBRdWVyeSBmb3IgYXBwcm94aW1hdGUgY291bnQuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModmFsdWUpLFxuICAgICAgdCA9IHRoaXMuX3RhYmxlLFxuICAgICAgcSA9IHRoaXMuX3EsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLFxuICAgICAgbiA9IHRoaXMuX251bSxcbiAgICAgIHMgPSAxIC8gKHctMSksXG4gICAgICBtaW4gPSArSW5maW5pdHksIGMsIGksIHI7XG5cbiAgZm9yIChpPTAsIHI9MDsgaTxkOyArK2ksIHIrPXcpIHtcbiAgICBjID0gdFtyICsgbFtpXV07XG4gICAgaWYgKGMgPCBtaW4pIG1pbiA9IGM7XG4gICAgYyA9IGMgLSAobi1jKSAqIHM7XG4gICAgcVtpXSA9IGM7XG4gIH1cblxuICByZXR1cm4gKGMgPSBtZWRpYW4ocSkpIDwgMCA/IDAgOiBjID4gbWluID8gbWluIDogYztcbn07XG5cbi8vIEFwcHJveGltYXRlIGRvdCBwcm9kdWN0IHdpdGggYW5vdGhlciBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIG11c3QgaGF2ZSB0aGUgc2FtZSBkZXB0aCBhbmQgd2lkdGguXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gIGlmICh0aGlzLl93ICE9PSB0aGF0Ll93KSB0aHJvdyAnU2tldGNoIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKHRoaXMuX2QgIT09IHRoYXQuX2QpIHRocm93ICdTa2V0Y2ggZGVwdGhzIGRvIG5vdCBtYXRjaC4nO1xuXG4gIHZhciB0YSA9IHRoaXMuX3RhYmxlLFxuICAgICAgdGIgPSB0aGF0Ll90YWJsZSxcbiAgICAgIHEgPSB0aGlzLl9xLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBuID0gdGhpcy5fbnVtLFxuICAgICAgbSA9IHRoaXMuX2QgKiB3LFxuICAgICAgeiA9ICh3IC0gMSkgLyB3LFxuICAgICAgcyA9IDEgLyAody0xKSxcbiAgICAgIGRvdCA9IDAsIGkgPSAwO1xuXG4gIGRvIHtcbiAgICBkb3QgKz0gKHRhW2ldIC0gKG4tdGFbaV0pKnMpICogKHRiW2ldIC0gKG4tdGJbaV0pKnMpO1xuICAgIGlmICgrK2kgJSB3ID09PSAwKSB7XG4gICAgICBxW2kvdy0xXSA9IHogKiBkb3Q7XG4gICAgICBkb3QgPSAwO1xuICAgIH1cbiAgfSB3aGlsZSAoaSA8IG0pO1xuXG4gIHJldHVybiAoZG90ID0gbWVkaWFuKHEpKSA8IDAgPyAwIDogZG90O1xufTtcblxuZnVuY3Rpb24gbWVkaWFuKHEpIHtcbiAgcS5zb3J0KG51bWNtcCk7XG4gIHZhciBuID0gcS5sZW5ndGgsXG4gICAgICBoID0gfn4obi8yKTtcbiAgcmV0dXJuIG4gJSAyID8gcVtoXSA6IDAuNSAqIChxW2gtMV0gKyBxW2hdKTtcbn1cblxuZnVuY3Rpb24gbnVtY21wKGEsIGIpIHtcbiAgcmV0dXJuIGEgLSBiO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IENvdW50TWVhbk1pbjtcbiIsInZhciBoYXNoID0gcmVxdWlyZSgnLi9oYXNoJyk7XG5cbnZhciBUWVBFRF9BUlJBWVMgPSB0eXBlb2YgQXJyYXlCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIsXG4gICAgREVGQVVMVF9CSU5TID0gMTAyMSxcbiAgICBERUZBVUxUX0hBU0ggPSAzO1xuXG4vLyBDb3VudC1NaW4gc2tldGNoIGZvciBhcHByb3hpbWF0ZSBjb3VudGluZyBvZiB2YWx1ZSBmcmVxdWVuY2llcy5cbi8vIFNlZTogJ0FuIEltcHJvdmVkIERhdGEgU3RyZWFtIFN1bW1hcnk6IFRoZSBDb3VudC1NaW4gU2tldGNoIGFuZCBpdHNcbi8vIEFwcGxpY2F0aW9ucycgYnkgRy4gQ29ybW9kZSAmIFMuIE11dGh1a3Jpc2huYW4uXG4vLyBBcmd1bWVudCAqdyogc3BlY2lmaWVzIHRoZSB3aWR0aCAobnVtYmVyIG9mIHJvdyBlbnRyaWVzKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKmQqIHNwZWNpZmllcyB0aGUgZGVwdGggKG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucykgb2YgdGhlIHNrZXRjaC5cbmZ1bmN0aW9uIENvdW50TWluKHcsIGQpIHtcbiAgdGhpcy5fdyA9IHcgfHwgREVGQVVMVF9CSU5TO1xuICB0aGlzLl9kID0gZCB8fCBERUZBVUxUX0hBU0g7XG4gIHRoaXMuX251bSA9IDA7XG4gIFxuICBpZiAoVFlQRURfQVJSQVlTKSB7XG4gICAgdGhpcy5fdGFibGUgPSBuZXcgSW50MzJBcnJheShkKncpO1xuICB9IGVsc2Uge1xuICAgIHZhciBpID0gLTEsIG4gPSBkKnc7XG4gICAgdGhpcy5fdGFibGUgPSBBcnJheShuKTtcbiAgICB3aGlsZSAoKytpIDwgbikgdGhpcy5fdGFibGVbaV0gPSAwO1xuICB9XG4gIGhhc2guaW5pdC5jYWxsKHRoaXMpO1xufVxuXG5Db3VudE1pbi5jcmVhdGUgPSBmdW5jdGlvbihhY2N1cmFjeSwgcHJvYmFiaWxpdHkpIHtcbiAgYWNjdXJhY3kgPSBhY2N1cmFjeSB8fCAwLjE7XG4gIHByb2JhYmlsaXR5ID0gcHJvYmFiaWxpdHkgfHwgMC4wMDAxO1xuICB2YXIgZCA9IE1hdGguY2VpbCgtTWF0aC5sb2cocHJvYmFiaWxpdHkpKSB8IDAsXG4gICAgICB3ID0gTWF0aC5jZWlsKE1hdGguRSAvIGFjY3VyYWN5KSB8IDA7XG4gIHJldHVybiBuZXcgdGhpcyh3LCBkKTtcbn07XG5cbnZhciBwcm90byA9IENvdW50TWluLnByb3RvdHlwZTtcblxucHJvdG8ubG9jYXRpb25zID0gaGFzaC5sb2NhdGlvbnM7XG5cbi8vIEFkZCBhIHZhbHVlIHRvIHRoZSBza2V0Y2guXG5wcm90by5hZGQgPSBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHZhbHVlKSxcbiAgICAgIHQgPSB0aGlzLl90YWJsZSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsIGk7XG4gIGZvciAoaT0wOyBpPGQ7ICsraSkge1xuICAgIHRbaSp3ICsgbFtpXV0gKz0gMTtcbiAgfVxuICB0aGlzLl9udW0gKz0gMTtcbn07XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIG1pbiA9ICtJbmZpbml0eSxcbiAgICAgIGwgPSB0aGlzLmxvY2F0aW9ucyh2YWx1ZSksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLCBpLCByLCB2O1xuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIHYgPSB0W3IgKyBsW2ldXTtcbiAgICBpZiAodiA8IG1pbikgbWluID0gdjtcbiAgfVxuICByZXR1cm4gbWluO1xufTtcblxuLy8gQXBwcm94aW1hdGUgZG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgaWYgKHRoaXMuX3cgIT09IHRoYXQuX3cpIHRocm93ICdTa2V0Y2ggd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAodGhpcy5fZCAhPT0gdGhhdC5fZCkgdGhyb3cgJ1NrZXRjaCBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIHRhID0gdGhpcy5fdGFibGUsXG4gICAgICB0YiA9IHRoYXQuX3RhYmxlLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBtID0gdGhpcy5fZCAqIHcsXG4gICAgICBtaW4gPSArSW5maW5pdHksXG4gICAgICBkb3QgPSAwLCBpID0gMDtcblxuICBkbyB7XG4gICAgZG90ICs9IHRhW2ldICogdGJbaV07XG4gICAgaWYgKCsraSAlIHcgPT09IDApIHtcbiAgICAgIGlmIChkb3QgPCBtaW4pIG1pbiA9IGRvdDtcbiAgICAgIGRvdCA9IDA7XG4gICAgfVxuICB9IHdoaWxlIChpIDwgbSk7XG5cbiAgcmV0dXJuIG1pbjtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ291bnRNaW47XG4iLCJ2YXIgVFlQRURfQVJSQVlTID0gdHlwZW9mIEFycmF5QnVmZmVyICE9PSBcInVuZGVmaW5lZFwiO1xuXG4vLyBGb3dsZXIvTm9sbC9WbyBoYXNoaW5nLlxuZnVuY3Rpb24gZm52XzFhKHYpIHtcbiAgdmFyIG4gPSB2Lmxlbmd0aCxcbiAgICAgIGEgPSAyMTY2MTM2MjYxLFxuICAgICAgYyxcbiAgICAgIGQsXG4gICAgICBpID0gLTE7XG4gIHdoaWxlICgrK2kgPCBuKSB7XG4gICAgYyA9IHYuY2hhckNvZGVBdChpKTtcbiAgICBpZiAoKGQgPSBjICYgMHhmZjAwMDAwMCkpIHtcbiAgICAgIGEgXj0gZCA+PiAyNDtcbiAgICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gICAgfVxuICAgIGlmICgoZCA9IGMgJiAweGZmMDAwMCkpIHtcbiAgICAgIGEgXj0gZCA+PiAxNjtcbiAgICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gICAgfVxuICAgIGlmICgoZCA9IGMgJiAweGZmMDApKSB7XG4gICAgICBhIF49IGQgPj4gODtcbiAgICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gICAgfVxuICAgIGEgXj0gYyAmIDB4ZmY7XG4gICAgYSArPSAoYSA8PCAxKSArIChhIDw8IDQpICsgKGEgPDwgNykgKyAoYSA8PCA4KSArIChhIDw8IDI0KTtcbiAgfVxuICAvLyBGcm9tIGh0dHA6Ly9ob21lLmNvbWNhc3QubmV0L35icmV0bS9oYXNoLzYuaHRtbFxuICBhICs9IGEgPDwgMTM7XG4gIGEgXj0gYSA+PiA3O1xuICBhICs9IGEgPDwgMztcbiAgYSBePSBhID4+IDE3O1xuICBhICs9IGEgPDwgNTtcbiAgcmV0dXJuIGEgJiAweGZmZmZmZmZmO1xufVxuXG4vLyBPbmUgYWRkaXRpb25hbCBpdGVyYXRpb24gb2YgRk5WLCBnaXZlbiBhIGhhc2guXG5mdW5jdGlvbiBmbnZfMWFfYihhKSB7XG4gIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gIGEgKz0gYSA8PCAxMztcbiAgYSBePSBhID4+IDc7XG4gIGEgKz0gYSA8PCAzO1xuICBhIF49IGEgPj4gMTc7XG4gIGEgKz0gYSA8PCA1O1xuICByZXR1cm4gYSAmIDB4ZmZmZmZmZmY7XG59XG5cbi8vIG1peC1pbiBtZXRob2QgZm9yIG11bHRpLWhhc2ggaW5pdGlhbGl6YXRpb25cbm1vZHVsZS5leHBvcnRzLmluaXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGQgPSB0aGlzLl9kLFxuICAgICAgdyA9IHRoaXMuX3c7XG5cbiAgaWYgKFRZUEVEX0FSUkFZUykge1xuICAgIHZhciBrYnl0ZXMgPSAxIDw8IE1hdGguY2VpbChNYXRoLmxvZyhcbiAgICAgICAgICBNYXRoLmNlaWwoTWF0aC5sb2codykgLyBNYXRoLkxOMiAvIDgpXG4gICAgICAgICkgLyBNYXRoLkxOMiksXG4gICAgICAgIGFycmF5ID0ga2J5dGVzID09PSAxID8gVWludDhBcnJheSA6IGtieXRlcyA9PT0gMiA/IFVpbnQxNkFycmF5IDogVWludDMyQXJyYXksXG4gICAgICAgIGtidWZmZXIgPSBuZXcgQXJyYXlCdWZmZXIoa2J5dGVzICogZCk7XG4gICAgdGhpcy5fbG9jYXRpb25zID0gbmV3IGFycmF5KGtidWZmZXIpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuX2xvY2F0aW9ucyA9IFtdO1xuICB9XG59O1xuXG4vLyBtaXgtaW4gbWV0aG9kIGZvciBtdWx0aS1oYXNoIGNhbGN1bGF0aW9uXG4vLyBTZWUgaHR0cDovL3dpbGx3aGltLndvcmRwcmVzcy5jb20vMjAxMS8wOS8wMy9wcm9kdWNpbmctbi1oYXNoLWZ1bmN0aW9ucy1ieS1oYXNoaW5nLW9ubHktb25jZS9cbm1vZHVsZS5leHBvcnRzLmxvY2F0aW9ucyA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGQgPSB0aGlzLl9kLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICByID0gdGhpcy5fbG9jYXRpb25zLFxuICAgICAgYSA9IGZudl8xYSh2KSxcbiAgICAgIGIgPSBmbnZfMWFfYihhKSxcbiAgICAgIGkgPSAtMSxcbiAgICAgIHggPSBhICUgdztcbiAgd2hpbGUgKCsraSA8IGQpIHtcbiAgICByW2ldID0geCA8IDAgPyAoeCArIHcpIDogeDtcbiAgICB4ID0gKHggKyBiKSAlIHc7XG4gIH1cbiAgcmV0dXJuIHI7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5mbnZfMWEgPSBmbnZfMWE7XG5tb2R1bGUuZXhwb3J0cy5mbnZfMWFfYiA9IGZudl8xYV9iO1xuIl19
