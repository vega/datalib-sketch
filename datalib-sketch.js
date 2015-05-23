(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}(g.dl || (g.dl = {})).sketch = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = {
  Bloom:        require('./bloom'),
  CountMin:     require('./count-min'),
  CountMeanMin: require('./count-mean-min')
};
},{"./bloom":2,"./count-mean-min":3,"./count-min":4}],2:[function(require,module,exports){
// Bloom Filters test whether an element is a member of a set.
// False positive matches are possible, but false negatives are not.
// See http://en.wikipedia.org/wiki/Bloom_filter

// This code borrows heavily from http://github.com/jasondavies/bloomfilter.js

var hash = require('./hash');

var TYPED_ARRAYS = typeof ArrayBuffer !== "undefined",
    DEFAULT_BITS = 1024 * 1024 * 8, // 1MB
    DEFAULT_HASH = 5; // Optimal for 2% FPR over 1M elements

// Create a new bloom filter. If *w* is an array-like object, with a length
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

// Create a new bloom filter based on provided performance parameters.
// Argument *n* is the expected set size (cardinality).
// Argument *p* is the desired false positive rate.
// http://en.wikipedia.org/wiki/Bloom_filter#Optimal_number_of_hash_functions
BloomFilter.create = function(n, p) {
  var w = -n * Math.log(p) / (Math.LN2 * Math.LN2),
      d = (w / n) * Math.LN2;
  return new BloomFilter(~~w, ~~d);
};

// Create a new bloom filter from a serialized object.
BloomFilter.import = function(obj) {
  return new BloomFilter(obj.bits, obj.depth);
};

var proto = BloomFilter.prototype;

proto.locations = hash.locations;

// Add a value to the filter.
proto.add = function(v) {
  var l = this.locations(v + ''),
      i = -1,
      d = this._d,
      buckets = this._buckets;
  while (++i < d) buckets[Math.floor(l[i] / 32)] |= 1 << (l[i] % 32);
};

// Query for inclusion in the filter.
proto.query = function(v) {
  var l = this.locations(v + ''),
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

},{"./count-min":4}],4:[function(require,module,exports){
var hash = require('./hash');

var TYPED_ARRAYS = typeof ArrayBuffer !== "undefined",
    DEFAULT_BINS = 27191,
    DEFAULT_HASH = 9;

// Create a new Count-Min sketch for approximate counts of value frequencies.
// See: 'An Improved Data Stream Summary: The Count-Min Sketch and its
// Applications' by G. Cormode & S. Muthukrishnan.
// If argument *w* is an array-like object, with a length property, then the
// sketch is loaded with data from the array, each element is a 32-bit integer.
// Otherwise, *w* specifies the width (number of row entries) of the sketch.
// Argument *d* specifies the depth (number of hash functions) of the sketch.
// Argument *num* indicates the number of elements add. This should only be
// provided if *w* is an array, in which case *num* is required.
function CountMin(w, d, num) {
  w = w || DEFAULT_BINS;
  d = d || DEFAULT_HASH;

  var a, t, i=-1, n;
  if (typeof w !== "number") { a = w; w = a.length / d; }
  this._w = w;
  this._d = d;
  this._num = num || 0;
  n = w * d;

  if (TYPED_ARRAYS) {
    t = this._table = new Int32Array(n);
    if (a) while (++i < n) t[i] = a[i];
  } else {
    t = this._table = Array(n);
    if (a) while (++i < n) t[i] = a[i];
    while (++i < n) t[i] = 0;
  }
  hash.init.call(this);
}

// Create a new Count-Min sketch based on provided performance parameters.
// Argument *n* is the expected count of all elements
// Argument *e* is the acceptable absolute error.
// Argument *p* is the probability of not achieving the error bound.
// http://dimacs.rutgers.edu/~graham/pubs/papers/cmencyc.pdf
CountMin.create = function(n, e, p) {
  e = n ? (e ? e/n : 1/n) : 0.001;
  p = p || 0.001;
  var w = Math.ceil(Math.E / e),
      d = Math.ceil(-Math.log(p));
  return new this(w, d);
};

// Create a new Count-Min sketch from a serialized object.
CountMin.import = function(obj) {
  return new this(obj.counts, obj.depth, obj.num);
};

var proto = CountMin.prototype;

proto.locations = hash.locations;

// Add a value to the sketch.
proto.add = function(v) {
  var l = this.locations(v + ''),
      t = this._table,
      w = this._w,
      d = this._d, i, r;
  for (i=0, r=0; i<d; ++i, r+=w) {
    t[r + l[i]] += 1;
  }
  this._num += 1;
};

// Query for approximate count.
proto.query = function(v) {
  var min = +Infinity,
      l = this.locations(v + ''),
      t = this._table,
      w = this._w,
      d = this._d, i, r, c;
  for (i=0, r=0; i<d; ++i, r+=w) {
    c = t[r + l[i]];
    if (c < min) min = c;
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

// Return a JSON-compatible serialized version of this sketch.
proto.export = function() {
  return {
    num: this._num,
    depth: this._d,
    counts: [].slice.call(this._table)
  };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMiLCJzcmMvYmxvb20uanMiLCJzcmMvY291bnQtbWVhbi1taW4uanMiLCJzcmMvY291bnQtbWluLmpzIiwic3JjL2hhc2guanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNySkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0ge1xuICBCbG9vbTogICAgICAgIHJlcXVpcmUoJy4vYmxvb20nKSxcbiAgQ291bnRNaW46ICAgICByZXF1aXJlKCcuL2NvdW50LW1pbicpLFxuICBDb3VudE1lYW5NaW46IHJlcXVpcmUoJy4vY291bnQtbWVhbi1taW4nKVxufTsiLCIvLyBCbG9vbSBGaWx0ZXJzIHRlc3Qgd2hldGhlciBhbiBlbGVtZW50IGlzIGEgbWVtYmVyIG9mIGEgc2V0LlxuLy8gRmFsc2UgcG9zaXRpdmUgbWF0Y2hlcyBhcmUgcG9zc2libGUsIGJ1dCBmYWxzZSBuZWdhdGl2ZXMgYXJlIG5vdC5cbi8vIFNlZSBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jsb29tX2ZpbHRlclxuXG4vLyBUaGlzIGNvZGUgYm9ycm93cyBoZWF2aWx5IGZyb20gaHR0cDovL2dpdGh1Yi5jb20vamFzb25kYXZpZXMvYmxvb21maWx0ZXIuanNcblxudmFyIGhhc2ggPSByZXF1aXJlKCcuL2hhc2gnKTtcblxudmFyIFRZUEVEX0FSUkFZUyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIixcbiAgICBERUZBVUxUX0JJVFMgPSAxMDI0ICogMTAyNCAqIDgsIC8vIDFNQlxuICAgIERFRkFVTFRfSEFTSCA9IDU7IC8vIE9wdGltYWwgZm9yIDIlIEZQUiBvdmVyIDFNIGVsZW1lbnRzXG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIuIElmICp3KiBpcyBhbiBhcnJheS1saWtlIG9iamVjdCwgd2l0aCBhIGxlbmd0aFxuLy8gcHJvcGVydHksIHRoZW4gdGhlIGJsb29tIGZpbHRlciBpcyBsb2FkZWQgd2l0aCBkYXRhIGZyb20gdGhlIGFycmF5LCB3aGVyZVxuLy8gZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuIE90aGVyd2lzZSwgKncqIHNob3VsZCBzcGVjaWZ5IHRoZSB3aWR0aFxuLy8gb2YgdGhlIGZpbHRlciBpbiBiaXRzLiBOb3RlIHRoYXQgKncqIGlzIHJvdW5kZWQgdXAgdG8gdGhlIG5lYXJlc3QgbXVsdGlwbGVcbi8vIG9mIDMyLiAqZCogKHRoZSBmaWx0ZXIgZGVwdGgpIHNwZWNpZmllcyB0aGUgbnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zLlxuZnVuY3Rpb24gQmxvb21GaWx0ZXIodywgZCkge1xuICB3ID0gdyB8fCBERUZBVUxUX0JJVFM7XG4gIGQgPSBkIHx8IERFRkFVTFRfSEFTSDtcblxuICB2YXIgYTtcbiAgaWYgKHR5cGVvZiB3ICE9PSBcIm51bWJlclwiKSB7IGEgPSB3OyB3ID0gYS5sZW5ndGggKiAzMjsgfVxuXG4gIHZhciBuID0gTWF0aC5jZWlsKHcgLyAzMiksXG4gICAgICBpID0gLTEsIGJ1Y2tldHM7XG4gIHRoaXMuX3cgPSB3ID0gbiAqIDMyO1xuICB0aGlzLl9kID0gZDtcblxuICBpZiAoVFlQRURfQVJSQVlTKSB7XG4gICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMgPSBuZXcgSW50MzJBcnJheShuKTtcbiAgICBpZiAoYSkgd2hpbGUgKCsraSA8IG4pIGJ1Y2tldHNbaV0gPSBhW2ldO1xuICB9IGVsc2Uge1xuICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzID0gW107XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gYVtpXTtcbiAgICBlbHNlIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gMDtcbiAgfVxuICBoYXNoLmluaXQuY2FsbCh0aGlzKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IGJsb29tIGZpbHRlciBiYXNlZCBvbiBwcm92aWRlZCBwZXJmb3JtYW5jZSBwYXJhbWV0ZXJzLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBleHBlY3RlZCBzZXQgc2l6ZSAoY2FyZGluYWxpdHkpLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBkZXNpcmVkIGZhbHNlIHBvc2l0aXZlIHJhdGUuXG4vLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jsb29tX2ZpbHRlciNPcHRpbWFsX251bWJlcl9vZl9oYXNoX2Z1bmN0aW9uc1xuQmxvb21GaWx0ZXIuY3JlYXRlID0gZnVuY3Rpb24obiwgcCkge1xuICB2YXIgdyA9IC1uICogTWF0aC5sb2cocCkgLyAoTWF0aC5MTjIgKiBNYXRoLkxOMiksXG4gICAgICBkID0gKHcgLyBuKSAqIE1hdGguTE4yO1xuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKH5+dywgfn5kKTtcbn07XG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQmxvb21GaWx0ZXIuaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIob2JqLmJpdHMsIG9iai5kZXB0aCk7XG59O1xuXG52YXIgcHJvdG8gPSBCbG9vbUZpbHRlci5wcm90b3R5cGU7XG5cbnByb3RvLmxvY2F0aW9ucyA9IGhhc2gubG9jYXRpb25zO1xuXG4vLyBBZGQgYSB2YWx1ZSB0byB0aGUgZmlsdGVyLlxucHJvdG8uYWRkID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICBpID0gLTEsXG4gICAgICBkID0gdGhpcy5fZCxcbiAgICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzO1xuICB3aGlsZSAoKytpIDwgZCkgYnVja2V0c1tNYXRoLmZsb29yKGxbaV0gLyAzMildIHw9IDEgPDwgKGxbaV0gJSAzMik7XG59O1xuXG4vLyBRdWVyeSBmb3IgaW5jbHVzaW9uIGluIHRoZSBmaWx0ZXIuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBiLFxuICAgICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHM7XG4gIHdoaWxlICgrK2kgPCBkKSB7XG4gICAgYiA9IGxbaV07XG4gICAgaWYgKChidWNrZXRzW01hdGguZmxvb3IoYiAvIDMyKV0gJiAoMSA8PCAoYiAlIDMyKSkpID09PSAwKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXN0aW1hdGVkIGNhcmRpbmFsaXR5LlxucHJvdG8uc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiaXRzID0gMCwgaSwgbjtcbiAgZm9yIChpPTAsIG49YnVja2V0cy5sZW5ndGg7IGk8bjsgKytpKSBiaXRzICs9IGJpdGNvdW50KGJ1Y2tldHNbaV0pO1xuICByZXR1cm4gLXRoaXMuX3cgKiBNYXRoLmxvZygxIC0gYml0cyAvIHRoaXMuX3cpIC8gdGhpcy5fZDtcbn07XG5cbi8vIFVuaW9uIHRoaXMgYmxvb20gZmlsdGVyIHdpdGggYW5vdGhlci5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLnVuaW9uID0gZnVuY3Rpb24oYmYpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB6ID0gVFlQRURfQVJSQVlTID8gbmV3IEludDMyQXJyYXkobikgOiBBcnJheShuKSxcbiAgICAgIGk7XG5cbiAgZm9yIChpPTA7IGk8bjsgKytpKSB7XG4gICAgeltpXSA9IGFbaV0gfCBiW2ldO1xuICB9XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIoeiwgdGhpcy5fZCk7XG59O1xuXG4vLyBKYWNjYXJkIGNvLWVmZmljaWVudCBvZiB0d28gYmxvb20gZmlsdGVycy5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIHNpemUgYW5kIGhhc2ggY291bnQuXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5qYWNjYXJkID0gZnVuY3Rpb24oYmYpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB4LCB5LCB6LCBpO1xuXG4gIGZvciAoaT14PXk9ej0wOyBpPG47ICsraSkge1xuICAgIHggKz0gYml0Y291bnQoYVtpXSk7XG4gICAgeSArPSBiaXRjb3VudChiW2ldKTtcbiAgICB6ICs9IGJpdGNvdW50KGFbaV0gfCBiW2ldKTtcbiAgfVxuICB4ID0gTWF0aC5sb2coMSAtIHggLyB0aGlzLl93KTtcbiAgeSA9IE1hdGgubG9nKDEgLSB5IC8gdGhpcy5fdyk7XG4gIHogPSBNYXRoLmxvZygxIC0geiAvIHRoaXMuX3cpO1xuICByZXR1cm4gKHggKyB5KSAvIHogLSAxO1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIGZpbHRlci5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIGRlcHRoOiB0aGlzLl9kLFxuICAgIGJpdHM6IFtdLnNsaWNlLmNhbGwodGhpcy5fYnVja2V0cylcbiAgfTtcbn07XG5cbi8vIGh0dHA6Ly9ncmFwaGljcy5zdGFuZm9yZC5lZHUvfnNlYW5kZXIvYml0aGFja3MuaHRtbCNDb3VudEJpdHNTZXRQYXJhbGxlbFxuZnVuY3Rpb24gYml0Y291bnQodikge1xuICB2IC09ICh2ID4+IDEpICYgMHg1NTU1NTU1NTtcbiAgdiA9ICh2ICYgMHgzMzMzMzMzMykgKyAoKHYgPj4gMikgJiAweDMzMzMzMzMzKTtcbiAgcmV0dXJuICgodiArICh2ID4+IDQpICYgMHhGMEYwRjBGKSAqIDB4MTAxMDEwMSkgPj4gMjQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQmxvb21GaWx0ZXI7IiwiLy8gQ291bnQtTWVhbi1NaW4gc2tldGNoZXMgZXh0ZW5kIENvdW50LU1pbiB3aXRoIGltcHJvdmVkIGVzdGltYXRpb24uXG4vLyBTZWUgJ05ldyBFc3RpbWF0aW9uIEFsZ29yaXRobXMgZm9yIFN0cmVhbWluZyBEYXRhOiBDb3VudC1taW4gQ2FuIERvIE1vcmUnXG4vLyBieSBEZW5nICYgUmFmaWVpLCBodHRwOi8vd2ViZG9jcy5jcy51YWxiZXJ0YS5jYS9+ZmFuZGVuZy9wYXBlci9jbW0ucGRmXG5cbnZhciBDb3VudE1pbiA9IHJlcXVpcmUoJy4vY291bnQtbWluJyk7XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NZWFuLU1pbiBza2V0Y2guXG4vLyBJZiBhcmd1bWVudCAqdyogaXMgYW4gYXJyYXktbGlrZSBvYmplY3QsIHdpdGggYSBsZW5ndGggcHJvcGVydHksIHRoZW4gdGhlXG4vLyBza2V0Y2ggaXMgbG9hZGVkIHdpdGggZGF0YSBmcm9tIHRoZSBhcnJheSwgZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuXG4vLyBPdGhlcndpc2UsICp3KiBzcGVjaWZpZXMgdGhlIHdpZHRoIChudW1iZXIgb2Ygcm93IGVudHJpZXMpIG9mIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqZCogc3BlY2lmaWVzIHRoZSBkZXB0aCAobnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKm51bSogaW5kaWNhdGVzIHRoZSBudW1iZXIgb2YgZWxlbWVudHMgYWRkLiBUaGlzIHNob3VsZCBvbmx5IGJlXG4vLyBwcm92aWRlZCBpZiAqdyogaXMgYW4gYXJyYXksIGluIHdoaWNoIGNhc2UgKm51bSogaXMgcmVxdWlyZWQuXG5mdW5jdGlvbiBDb3VudE1lYW5NaW4odywgZCwgbnVtKSB7XG4gIENvdW50TWluLmNhbGwodGhpcywgdywgZCwgbnVtKTtcbiAgdGhpcy5fcSA9IEFycmF5KGQpO1xufVxuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWluIHNrZXRjaCBiYXNlZCBvbiBwcm92aWRlZCBwZXJmb3JtYW5jZSBwYXJhbWV0ZXJzLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBleHBlY3RlZCBjb3VudCBvZiBhbGwgZWxlbWVudHNcbi8vIEFyZ3VtZW50ICplKiBpcyB0aGUgYWNjZXB0YWJsZSBhYnNvbHV0ZSBlcnJvci5cbi8vIEFyZ3VtZW50ICpwKiBpcyB0aGUgcHJvYmFiaWxpdHkgb2Ygbm90IGFjaGlldmluZyB0aGUgZXJyb3IgYm91bmQuXG5Db3VudE1lYW5NaW4uY3JlYXRlID0gQ291bnRNaW4uY3JlYXRlO1xuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWVhbi1NaW4gc2tldGNoIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdC5cbkNvdW50TWVhbk1pbi5pbXBvcnQgPSBDb3VudE1pbi5pbXBvcnQ7XG5cbnZhciBwcm90byA9IChDb3VudE1lYW5NaW4ucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShDb3VudE1pbi5wcm90b3R5cGUpKTtcblxuLy8gUXVlcnkgZm9yIGFwcHJveGltYXRlIGNvdW50LlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModiArICcnKSxcbiAgICAgIHQgPSB0aGlzLl90YWJsZSxcbiAgICAgIHEgPSB0aGlzLl9xLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBkID0gdGhpcy5fZCxcbiAgICAgIG4gPSB0aGlzLl9udW0sXG4gICAgICBzID0gMSAvICh3LTEpLFxuICAgICAgbWluID0gK0luZmluaXR5LCBjLCBpLCByO1xuXG4gIGZvciAoaT0wLCByPTA7IGk8ZDsgKytpLCByKz13KSB7XG4gICAgYyA9IHRbciArIGxbaV1dO1xuICAgIGlmIChjIDwgbWluKSBtaW4gPSBjO1xuICAgIGMgPSBjIC0gKG4tYykgKiBzO1xuICAgIHFbaV0gPSBjO1xuICB9XG5cbiAgcmV0dXJuIChjID0gbWVkaWFuKHEpKSA8IDAgPyAwIDogYyA+IG1pbiA/IG1pbiA6IGM7XG59O1xuXG4vLyBBcHByb3hpbWF0ZSBkb3QgcHJvZHVjdCB3aXRoIGFub3RoZXIgc2tldGNoLlxuLy8gVGhlIGlucHV0IHNrZXRjaCBtdXN0IGhhdmUgdGhlIHNhbWUgZGVwdGggYW5kIHdpZHRoLlxuLy8gT3RoZXJ3aXNlLCB0aGlzIG1ldGhvZCB3aWxsIHRocm93IGFuIGVycm9yLlxucHJvdG8uZG90ID0gZnVuY3Rpb24odGhhdCkge1xuICBpZiAodGhpcy5fdyAhPT0gdGhhdC5fdykgdGhyb3cgJ1NrZXRjaCB3aWR0aHMgZG8gbm90IG1hdGNoLic7XG4gIGlmICh0aGlzLl9kICE9PSB0aGF0Ll9kKSB0aHJvdyAnU2tldGNoIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgdGEgPSB0aGlzLl90YWJsZSxcbiAgICAgIHRiID0gdGhhdC5fdGFibGUsXG4gICAgICBxID0gdGhpcy5fcSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgbiA9IHRoaXMuX251bSxcbiAgICAgIG0gPSB0aGlzLl9kICogdyxcbiAgICAgIHogPSAodyAtIDEpIC8gdyxcbiAgICAgIHMgPSAxIC8gKHctMSksXG4gICAgICBkb3QgPSAwLCBpID0gMDtcblxuICBkbyB7XG4gICAgZG90ICs9ICh0YVtpXSAtIChuLXRhW2ldKSpzKSAqICh0YltpXSAtIChuLXRiW2ldKSpzKTtcbiAgICBpZiAoKytpICUgdyA9PT0gMCkge1xuICAgICAgcVtpL3ctMV0gPSB6ICogZG90O1xuICAgICAgZG90ID0gMDtcbiAgICB9XG4gIH0gd2hpbGUgKGkgPCBtKTtcblxuICByZXR1cm4gKGRvdCA9IG1lZGlhbihxKSkgPCAwID8gMCA6IGRvdDtcbn07XG5cbmZ1bmN0aW9uIG1lZGlhbihxKSB7XG4gIHEuc29ydChudW1jbXApO1xuICB2YXIgbiA9IHEubGVuZ3RoLFxuICAgICAgaCA9IH5+KG4vMik7XG4gIHJldHVybiBuICUgMiA/IHFbaF0gOiAwLjUgKiAocVtoLTFdICsgcVtoXSk7XG59XG5cbmZ1bmN0aW9uIG51bWNtcChhLCBiKSB7XG4gIHJldHVybiBhIC0gYjtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBDb3VudE1lYW5NaW47XG4iLCJ2YXIgaGFzaCA9IHJlcXVpcmUoJy4vaGFzaCcpO1xuXG52YXIgVFlQRURfQVJSQVlTID0gdHlwZW9mIEFycmF5QnVmZmVyICE9PSBcInVuZGVmaW5lZFwiLFxuICAgIERFRkFVTFRfQklOUyA9IDI3MTkxLFxuICAgIERFRkFVTFRfSEFTSCA9IDk7XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGZvciBhcHByb3hpbWF0ZSBjb3VudHMgb2YgdmFsdWUgZnJlcXVlbmNpZXMuXG4vLyBTZWU6ICdBbiBJbXByb3ZlZCBEYXRhIFN0cmVhbSBTdW1tYXJ5OiBUaGUgQ291bnQtTWluIFNrZXRjaCBhbmQgaXRzXG4vLyBBcHBsaWNhdGlvbnMnIGJ5IEcuIENvcm1vZGUgJiBTLiBNdXRodWtyaXNobmFuLlxuLy8gSWYgYXJndW1lbnQgKncqIGlzIGFuIGFycmF5LWxpa2Ugb2JqZWN0LCB3aXRoIGEgbGVuZ3RoIHByb3BlcnR5LCB0aGVuIHRoZVxuLy8gc2tldGNoIGlzIGxvYWRlZCB3aXRoIGRhdGEgZnJvbSB0aGUgYXJyYXksIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLlxuLy8gT3RoZXJ3aXNlLCAqdyogc3BlY2lmaWVzIHRoZSB3aWR0aCAobnVtYmVyIG9mIHJvdyBlbnRyaWVzKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKmQqIHNwZWNpZmllcyB0aGUgZGVwdGggKG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpudW0qIGluZGljYXRlcyB0aGUgbnVtYmVyIG9mIGVsZW1lbnRzIGFkZC4gVGhpcyBzaG91bGQgb25seSBiZVxuLy8gcHJvdmlkZWQgaWYgKncqIGlzIGFuIGFycmF5LCBpbiB3aGljaCBjYXNlICpudW0qIGlzIHJlcXVpcmVkLlxuZnVuY3Rpb24gQ291bnRNaW4odywgZCwgbnVtKSB7XG4gIHcgPSB3IHx8IERFRkFVTFRfQklOUztcbiAgZCA9IGQgfHwgREVGQVVMVF9IQVNIO1xuXG4gIHZhciBhLCB0LCBpPS0xLCBuO1xuICBpZiAodHlwZW9mIHcgIT09IFwibnVtYmVyXCIpIHsgYSA9IHc7IHcgPSBhLmxlbmd0aCAvIGQ7IH1cbiAgdGhpcy5fdyA9IHc7XG4gIHRoaXMuX2QgPSBkO1xuICB0aGlzLl9udW0gPSBudW0gfHwgMDtcbiAgbiA9IHcgKiBkO1xuXG4gIGlmIChUWVBFRF9BUlJBWVMpIHtcbiAgICB0ID0gdGhpcy5fdGFibGUgPSBuZXcgSW50MzJBcnJheShuKTtcbiAgICBpZiAoYSkgd2hpbGUgKCsraSA8IG4pIHRbaV0gPSBhW2ldO1xuICB9IGVsc2Uge1xuICAgIHQgPSB0aGlzLl90YWJsZSA9IEFycmF5KG4pO1xuICAgIGlmIChhKSB3aGlsZSAoKytpIDwgbikgdFtpXSA9IGFbaV07XG4gICAgd2hpbGUgKCsraSA8IG4pIHRbaV0gPSAwO1xuICB9XG4gIGhhc2guaW5pdC5jYWxsKHRoaXMpO1xufVxuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWluIHNrZXRjaCBiYXNlZCBvbiBwcm92aWRlZCBwZXJmb3JtYW5jZSBwYXJhbWV0ZXJzLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBleHBlY3RlZCBjb3VudCBvZiBhbGwgZWxlbWVudHNcbi8vIEFyZ3VtZW50ICplKiBpcyB0aGUgYWNjZXB0YWJsZSBhYnNvbHV0ZSBlcnJvci5cbi8vIEFyZ3VtZW50ICpwKiBpcyB0aGUgcHJvYmFiaWxpdHkgb2Ygbm90IGFjaGlldmluZyB0aGUgZXJyb3IgYm91bmQuXG4vLyBodHRwOi8vZGltYWNzLnJ1dGdlcnMuZWR1L35ncmFoYW0vcHVicy9wYXBlcnMvY21lbmN5Yy5wZGZcbkNvdW50TWluLmNyZWF0ZSA9IGZ1bmN0aW9uKG4sIGUsIHApIHtcbiAgZSA9IG4gPyAoZSA/IGUvbiA6IDEvbikgOiAwLjAwMTtcbiAgcCA9IHAgfHwgMC4wMDE7XG4gIHZhciB3ID0gTWF0aC5jZWlsKE1hdGguRSAvIGUpLFxuICAgICAgZCA9IE1hdGguY2VpbCgtTWF0aC5sb2cocCkpO1xuICByZXR1cm4gbmV3IHRoaXModywgZCk7XG59O1xuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWluIHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5Db3VudE1pbi5pbXBvcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgcmV0dXJuIG5ldyB0aGlzKG9iai5jb3VudHMsIG9iai5kZXB0aCwgb2JqLm51bSk7XG59O1xuXG52YXIgcHJvdG8gPSBDb3VudE1pbi5wcm90b3R5cGU7XG5cbnByb3RvLmxvY2F0aW9ucyA9IGhhc2gubG9jYXRpb25zO1xuXG4vLyBBZGQgYSB2YWx1ZSB0byB0aGUgc2tldGNoLlxucHJvdG8uYWRkID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLCBpLCByO1xuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIHRbciArIGxbaV1dICs9IDE7XG4gIH1cbiAgdGhpcy5fbnVtICs9IDE7XG59O1xuXG4vLyBRdWVyeSBmb3IgYXBwcm94aW1hdGUgY291bnQuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIG1pbiA9ICtJbmZpbml0eSxcbiAgICAgIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgdCA9IHRoaXMuX3RhYmxlLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBkID0gdGhpcy5fZCwgaSwgciwgYztcbiAgZm9yIChpPTAsIHI9MDsgaTxkOyArK2ksIHIrPXcpIHtcbiAgICBjID0gdFtyICsgbFtpXV07XG4gICAgaWYgKGMgPCBtaW4pIG1pbiA9IGM7XG4gIH1cbiAgcmV0dXJuIG1pbjtcbn07XG5cbi8vIEFwcHJveGltYXRlIGRvdCBwcm9kdWN0IHdpdGggYW5vdGhlciBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIG11c3QgaGF2ZSB0aGUgc2FtZSBkZXB0aCBhbmQgd2lkdGguXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gIGlmICh0aGlzLl93ICE9PSB0aGF0Ll93KSB0aHJvdyAnU2tldGNoIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKHRoaXMuX2QgIT09IHRoYXQuX2QpIHRocm93ICdTa2V0Y2ggZGVwdGhzIGRvIG5vdCBtYXRjaC4nO1xuXG4gIHZhciB0YSA9IHRoaXMuX3RhYmxlLFxuICAgICAgdGIgPSB0aGF0Ll90YWJsZSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgbSA9IHRoaXMuX2QgKiB3LFxuICAgICAgbWluID0gK0luZmluaXR5LFxuICAgICAgZG90ID0gMCwgaSA9IDA7XG5cbiAgZG8ge1xuICAgIGRvdCArPSB0YVtpXSAqIHRiW2ldO1xuICAgIGlmICgrK2kgJSB3ID09PSAwKSB7XG4gICAgICBpZiAoZG90IDwgbWluKSBtaW4gPSBkb3Q7XG4gICAgICBkb3QgPSAwO1xuICAgIH1cbiAgfSB3aGlsZSAoaSA8IG0pO1xuXG4gIHJldHVybiBtaW47XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgc2tldGNoLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgbnVtOiB0aGlzLl9udW0sXG4gICAgZGVwdGg6IHRoaXMuX2QsXG4gICAgY291bnRzOiBbXS5zbGljZS5jYWxsKHRoaXMuX3RhYmxlKVxuICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBDb3VudE1pbjtcbiIsInZhciBUWVBFRF9BUlJBWVMgPSB0eXBlb2YgQXJyYXlCdWZmZXIgIT09IFwidW5kZWZpbmVkXCI7XG5cbi8vIEZvd2xlci9Ob2xsL1ZvIGhhc2hpbmcuXG5mdW5jdGlvbiBmbnZfMWEodikge1xuICB2YXIgbiA9IHYubGVuZ3RoLFxuICAgICAgYSA9IDIxNjYxMzYyNjEsXG4gICAgICBjLFxuICAgICAgZCxcbiAgICAgIGkgPSAtMTtcbiAgd2hpbGUgKCsraSA8IG4pIHtcbiAgICBjID0gdi5jaGFyQ29kZUF0KGkpO1xuICAgIGlmICgoZCA9IGMgJiAweGZmMDAwMDAwKSkge1xuICAgICAgYSBePSBkID4+IDI0O1xuICAgICAgYSArPSAoYSA8PCAxKSArIChhIDw8IDQpICsgKGEgPDwgNykgKyAoYSA8PCA4KSArIChhIDw8IDI0KTtcbiAgICB9XG4gICAgaWYgKChkID0gYyAmIDB4ZmYwMDAwKSkge1xuICAgICAgYSBePSBkID4+IDE2O1xuICAgICAgYSArPSAoYSA8PCAxKSArIChhIDw8IDQpICsgKGEgPDwgNykgKyAoYSA8PCA4KSArIChhIDw8IDI0KTtcbiAgICB9XG4gICAgaWYgKChkID0gYyAmIDB4ZmYwMCkpIHtcbiAgICAgIGEgXj0gZCA+PiA4O1xuICAgICAgYSArPSAoYSA8PCAxKSArIChhIDw8IDQpICsgKGEgPDwgNykgKyAoYSA8PCA4KSArIChhIDw8IDI0KTtcbiAgICB9XG4gICAgYSBePSBjICYgMHhmZjtcbiAgICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICB9XG4gIC8vIEZyb20gaHR0cDovL2hvbWUuY29tY2FzdC5uZXQvfmJyZXRtL2hhc2gvNi5odG1sXG4gIGEgKz0gYSA8PCAxMztcbiAgYSBePSBhID4+IDc7XG4gIGEgKz0gYSA8PCAzO1xuICBhIF49IGEgPj4gMTc7XG4gIGEgKz0gYSA8PCA1O1xuICByZXR1cm4gYSAmIDB4ZmZmZmZmZmY7XG59XG5cbi8vIE9uZSBhZGRpdGlvbmFsIGl0ZXJhdGlvbiBvZiBGTlYsIGdpdmVuIGEgaGFzaC5cbmZ1bmN0aW9uIGZudl8xYV9iKGEpIHtcbiAgYSArPSAoYSA8PCAxKSArIChhIDw8IDQpICsgKGEgPDwgNykgKyAoYSA8PCA4KSArIChhIDw8IDI0KTtcbiAgYSArPSBhIDw8IDEzO1xuICBhIF49IGEgPj4gNztcbiAgYSArPSBhIDw8IDM7XG4gIGEgXj0gYSA+PiAxNztcbiAgYSArPSBhIDw8IDU7XG4gIHJldHVybiBhICYgMHhmZmZmZmZmZjtcbn1cblxuLy8gbWl4LWluIG1ldGhvZCBmb3IgbXVsdGktaGFzaCBpbml0aWFsaXphdGlvblxubW9kdWxlLmV4cG9ydHMuaW5pdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgZCA9IHRoaXMuX2QsXG4gICAgICB3ID0gdGhpcy5fdztcblxuICBpZiAoVFlQRURfQVJSQVlTKSB7XG4gICAgdmFyIGtieXRlcyA9IDEgPDwgTWF0aC5jZWlsKE1hdGgubG9nKFxuICAgICAgICAgIE1hdGguY2VpbChNYXRoLmxvZyh3KSAvIE1hdGguTE4yIC8gOClcbiAgICAgICAgKSAvIE1hdGguTE4yKSxcbiAgICAgICAgYXJyYXkgPSBrYnl0ZXMgPT09IDEgPyBVaW50OEFycmF5IDoga2J5dGVzID09PSAyID8gVWludDE2QXJyYXkgOiBVaW50MzJBcnJheSxcbiAgICAgICAga2J1ZmZlciA9IG5ldyBBcnJheUJ1ZmZlcihrYnl0ZXMgKiBkKTtcbiAgICB0aGlzLl9sb2NhdGlvbnMgPSBuZXcgYXJyYXkoa2J1ZmZlcik7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5fbG9jYXRpb25zID0gW107XG4gIH1cbn07XG5cbi8vIG1peC1pbiBtZXRob2QgZm9yIG11bHRpLWhhc2ggY2FsY3VsYXRpb25cbi8vIFNlZSBodHRwOi8vd2lsbHdoaW0ud29yZHByZXNzLmNvbS8yMDExLzA5LzAzL3Byb2R1Y2luZy1uLWhhc2gtZnVuY3Rpb25zLWJ5LWhhc2hpbmctb25seS1vbmNlL1xubW9kdWxlLmV4cG9ydHMubG9jYXRpb25zID0gZnVuY3Rpb24odikge1xuICB2YXIgZCA9IHRoaXMuX2QsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIHIgPSB0aGlzLl9sb2NhdGlvbnMsXG4gICAgICBhID0gZm52XzFhKHYpLFxuICAgICAgYiA9IGZudl8xYV9iKGEpLFxuICAgICAgaSA9IC0xLFxuICAgICAgeCA9IGEgJSB3O1xuICB3aGlsZSAoKytpIDwgZCkge1xuICAgIHJbaV0gPSB4IDwgMCA/ICh4ICsgdykgOiB4O1xuICAgIHggPSAoeCArIGIpICUgdztcbiAgfVxuICByZXR1cm4gcjtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmZudl8xYSA9IGZudl8xYTtcbm1vZHVsZS5leHBvcnRzLmZudl8xYV9iID0gZm52XzFhX2I7XG4iXX0=
