(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}(g.dl || (g.dl = {})).sketch = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

// Internal helper method for bloom filter comparison estimates.
proto._estimate = function(bf, kernel) {
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
  return kernel(x, y, z);
};

// Jaccard co-efficient of two bloom filters.
// The input filter must have the same size and hash count.
// Otherwise, this method will throw an error.
proto.jaccard = function(bf) {
  return this._estimate(bf, function(a, b, union) {
    return (a + b) / union - 1;
  });
};

// Set cover over the smaller of two bloom filters.
// The input filter must have the same size and hash count.
// Otherwise, this method will throw an error.
proto.cover = function(bf) {
  return this._estimate(bf, function(a, b, union) {
    return (a + b - union) / Math.max(a, b);
  });
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
},{"./hash":4}],2:[function(require,module,exports){
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

},{"./count-min":3}],3:[function(require,module,exports){
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

},{"./hash":4}],4:[function(require,module,exports){
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

},{}],5:[function(require,module,exports){
module.exports = {
  Bloom:        require('./bloom'),
  CountMin:     require('./count-min'),
  CountMeanMin: require('./count-mean-min'),
  NGram:        require('./ngram')
};
},{"./bloom":1,"./count-mean-min":2,"./count-min":3,"./ngram":6}],6:[function(require,module,exports){
// Create a new character-level n-gram sketch.
// *n* is the number of characters to include, defaults to 2.
// *caseSensitive* indicates case-sensitivity, defaults to false.
// *map* is an optional existing ngram to count map.
function NGram(n, caseSensitive, map) {
  this._n = n == null ? 2 : n;
  this._case = !!caseSensitive;
  this._map = map || {};
  this._norm = null;
}

NGram.import = function(obj) {
  return new NGram(obj.n, obj.case, obj.counts);
};

var proto = NGram.prototype;

// Add all consecutive n-grams in *s* to this sketch
proto.add = function(s) {
  if (s == null || s === '') return;
  this._norm = null;
  counts(String(s), this._n, this._case, this._map);
};

// add counts of n-grams in string to a map
function counts(s, n, c, map) {
  var len = s.length - n + 1,
      k, i;
  
  for (i=0; i<len; ++i) {
    k = s.substr(i, n);
    if (!c) k = k.toLowerCase();
    map[k] = map[k] ? map[k] + 1 : 1;
  }
}

// The occurrence count of a given n-gram.
proto.query = function(key) {
  return this._map[this._case ? key : key.toLowerCase()] || 0;
};

// Return the number of unique n-grams observed.
proto.size = function() {
  return Object.keys(this._map).length;
};

// Return the vector norm of the counts in this sketch.
proto.norm = function() {
  if (this._norm == null) {
    var m = this._map,
        s = 0, k;
    for (k in m) {
      s += m[k] * m[k];
    }
    this._norm = Math.sqrt(s);
  }
  return this._norm;
};

// Dot product with another n-gram sketch.
// The input sketch should have the same *n* parameter.
proto.dot = function(that) {
  var a = this._map,
      b = that._map,
      dot = 0, k;

  for (k in a) {
    dot += a[k] * (b[k] || 0);
  }
  
  return dot;
};

// Cosine similarity with another n-gram sketch.
// The input sketch should have the same *n* parameter.
proto.cosine = function(that) {
  var aa = this.norm(),
      bb = that.norm();
  return this.dot(that) / (aa * bb);
};

// Return a JSON-compatible serialized version of this sketch.
proto.export = function() {
  return {
    n: this._n,
    case: this._case,
    counts: this._map
  };
};

module.exports = NGram;

},{}]},{},[5])(5)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYmxvb20uanMiLCJzcmMvY291bnQtbWVhbi1taW4uanMiLCJzcmMvY291bnQtbWluLmpzIiwic3JjL2hhc2guanMiLCJzcmMvaW5kZXguanMiLCJzcmMvbmdyYW0uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvLyBCbG9vbSBGaWx0ZXJzIHRlc3Qgd2hldGhlciBhbiBlbGVtZW50IGlzIGEgbWVtYmVyIG9mIGEgc2V0LlxuLy8gRmFsc2UgcG9zaXRpdmUgbWF0Y2hlcyBhcmUgcG9zc2libGUsIGJ1dCBmYWxzZSBuZWdhdGl2ZXMgYXJlIG5vdC5cbi8vIFNlZSBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jsb29tX2ZpbHRlclxuXG4vLyBUaGlzIGNvZGUgYm9ycm93cyBoZWF2aWx5IGZyb20gaHR0cDovL2dpdGh1Yi5jb20vamFzb25kYXZpZXMvYmxvb21maWx0ZXIuanNcblxudmFyIGhhc2ggPSByZXF1aXJlKCcuL2hhc2gnKTtcblxudmFyIFRZUEVEX0FSUkFZUyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIixcbiAgICBERUZBVUxUX0JJVFMgPSAxMDI0ICogMTAyNCAqIDgsIC8vIDFNQlxuICAgIERFRkFVTFRfSEFTSCA9IDU7IC8vIE9wdGltYWwgZm9yIDIlIEZQUiBvdmVyIDFNIGVsZW1lbnRzXG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIuIElmICp3KiBpcyBhbiBhcnJheS1saWtlIG9iamVjdCwgd2l0aCBhIGxlbmd0aFxuLy8gcHJvcGVydHksIHRoZW4gdGhlIGJsb29tIGZpbHRlciBpcyBsb2FkZWQgd2l0aCBkYXRhIGZyb20gdGhlIGFycmF5LCB3aGVyZVxuLy8gZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuIE90aGVyd2lzZSwgKncqIHNob3VsZCBzcGVjaWZ5IHRoZSB3aWR0aFxuLy8gb2YgdGhlIGZpbHRlciBpbiBiaXRzLiBOb3RlIHRoYXQgKncqIGlzIHJvdW5kZWQgdXAgdG8gdGhlIG5lYXJlc3QgbXVsdGlwbGVcbi8vIG9mIDMyLiAqZCogKHRoZSBmaWx0ZXIgZGVwdGgpIHNwZWNpZmllcyB0aGUgbnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zLlxuZnVuY3Rpb24gQmxvb21GaWx0ZXIodywgZCkge1xuICB3ID0gdyB8fCBERUZBVUxUX0JJVFM7XG4gIGQgPSBkIHx8IERFRkFVTFRfSEFTSDtcblxuICB2YXIgYTtcbiAgaWYgKHR5cGVvZiB3ICE9PSBcIm51bWJlclwiKSB7IGEgPSB3OyB3ID0gYS5sZW5ndGggKiAzMjsgfVxuXG4gIHZhciBuID0gTWF0aC5jZWlsKHcgLyAzMiksXG4gICAgICBpID0gLTEsIGJ1Y2tldHM7XG4gIHRoaXMuX3cgPSB3ID0gbiAqIDMyO1xuICB0aGlzLl9kID0gZDtcblxuICBpZiAoVFlQRURfQVJSQVlTKSB7XG4gICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMgPSBuZXcgSW50MzJBcnJheShuKTtcbiAgICBpZiAoYSkgd2hpbGUgKCsraSA8IG4pIGJ1Y2tldHNbaV0gPSBhW2ldO1xuICB9IGVsc2Uge1xuICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzID0gW107XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gYVtpXTtcbiAgICBlbHNlIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gMDtcbiAgfVxuICBoYXNoLmluaXQuY2FsbCh0aGlzKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IGJsb29tIGZpbHRlciBiYXNlZCBvbiBwcm92aWRlZCBwZXJmb3JtYW5jZSBwYXJhbWV0ZXJzLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBleHBlY3RlZCBzZXQgc2l6ZSAoY2FyZGluYWxpdHkpLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBkZXNpcmVkIGZhbHNlIHBvc2l0aXZlIHJhdGUuXG4vLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jsb29tX2ZpbHRlciNPcHRpbWFsX251bWJlcl9vZl9oYXNoX2Z1bmN0aW9uc1xuQmxvb21GaWx0ZXIuY3JlYXRlID0gZnVuY3Rpb24obiwgcCkge1xuICB2YXIgdyA9IC1uICogTWF0aC5sb2cocCkgLyAoTWF0aC5MTjIgKiBNYXRoLkxOMiksXG4gICAgICBkID0gKHcgLyBuKSAqIE1hdGguTE4yO1xuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKH5+dywgfn5kKTtcbn07XG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQmxvb21GaWx0ZXIuaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIob2JqLmJpdHMsIG9iai5kZXB0aCk7XG59O1xuXG52YXIgcHJvdG8gPSBCbG9vbUZpbHRlci5wcm90b3R5cGU7XG5cbnByb3RvLmxvY2F0aW9ucyA9IGhhc2gubG9jYXRpb25zO1xuXG4vLyBBZGQgYSB2YWx1ZSB0byB0aGUgZmlsdGVyLlxucHJvdG8uYWRkID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICBpID0gLTEsXG4gICAgICBkID0gdGhpcy5fZCxcbiAgICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzO1xuICB3aGlsZSAoKytpIDwgZCkgYnVja2V0c1tNYXRoLmZsb29yKGxbaV0gLyAzMildIHw9IDEgPDwgKGxbaV0gJSAzMik7XG59O1xuXG4vLyBRdWVyeSBmb3IgaW5jbHVzaW9uIGluIHRoZSBmaWx0ZXIuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBiLFxuICAgICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHM7XG4gIHdoaWxlICgrK2kgPCBkKSB7XG4gICAgYiA9IGxbaV07XG4gICAgaWYgKChidWNrZXRzW01hdGguZmxvb3IoYiAvIDMyKV0gJiAoMSA8PCAoYiAlIDMyKSkpID09PSAwKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXN0aW1hdGVkIGNhcmRpbmFsaXR5LlxucHJvdG8uc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiaXRzID0gMCwgaSwgbjtcbiAgZm9yIChpPTAsIG49YnVja2V0cy5sZW5ndGg7IGk8bjsgKytpKSBiaXRzICs9IGJpdGNvdW50KGJ1Y2tldHNbaV0pO1xuICByZXR1cm4gLXRoaXMuX3cgKiBNYXRoLmxvZygxIC0gYml0cyAvIHRoaXMuX3cpIC8gdGhpcy5fZDtcbn07XG5cbi8vIFVuaW9uIHRoaXMgYmxvb20gZmlsdGVyIHdpdGggYW5vdGhlci5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLnVuaW9uID0gZnVuY3Rpb24oYmYpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB6ID0gVFlQRURfQVJSQVlTID8gbmV3IEludDMyQXJyYXkobikgOiBBcnJheShuKSxcbiAgICAgIGk7XG5cbiAgZm9yIChpPTA7IGk8bjsgKytpKSB7XG4gICAgeltpXSA9IGFbaV0gfCBiW2ldO1xuICB9XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIoeiwgdGhpcy5fZCk7XG59O1xuXG4vLyBJbnRlcm5hbCBoZWxwZXIgbWV0aG9kIGZvciBibG9vbSBmaWx0ZXIgY29tcGFyaXNvbiBlc3RpbWF0ZXMuXG5wcm90by5fZXN0aW1hdGUgPSBmdW5jdGlvbihiZiwga2VybmVsKSB7XG4gIGlmIChiZi5fdyAhPT0gdGhpcy5fdykgdGhyb3cgJ0ZpbHRlciB3aWR0aHMgZG8gbm90IG1hdGNoLic7XG4gIGlmIChiZi5fZCAhPT0gdGhpcy5fZCkgdGhyb3cgJ0ZpbHRlciBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIGEgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgYiA9IGJmLl9idWNrZXRzLFxuICAgICAgbiA9IGEubGVuZ3RoLFxuICAgICAgeCwgeSwgeiwgaTtcblxuICBmb3IgKGk9eD15PXo9MDsgaTxuOyArK2kpIHtcbiAgICB4ICs9IGJpdGNvdW50KGFbaV0pO1xuICAgIHkgKz0gYml0Y291bnQoYltpXSk7XG4gICAgeiArPSBiaXRjb3VudChhW2ldIHwgYltpXSk7XG4gIH1cbiAgeCA9IE1hdGgubG9nKDEgLSB4IC8gdGhpcy5fdyk7XG4gIHkgPSBNYXRoLmxvZygxIC0geSAvIHRoaXMuX3cpO1xuICB6ID0gTWF0aC5sb2coMSAtIHogLyB0aGlzLl93KTtcbiAgcmV0dXJuIGtlcm5lbCh4LCB5LCB6KTtcbn07XG5cbi8vIEphY2NhcmQgY28tZWZmaWNpZW50IG9mIHR3byBibG9vbSBmaWx0ZXJzLlxuLy8gVGhlIGlucHV0IGZpbHRlciBtdXN0IGhhdmUgdGhlIHNhbWUgc2l6ZSBhbmQgaGFzaCBjb3VudC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmphY2NhcmQgPSBmdW5jdGlvbihiZikge1xuICByZXR1cm4gdGhpcy5fZXN0aW1hdGUoYmYsIGZ1bmN0aW9uKGEsIGIsIHVuaW9uKSB7XG4gICAgcmV0dXJuIChhICsgYikgLyB1bmlvbiAtIDE7XG4gIH0pO1xufTtcblxuLy8gU2V0IGNvdmVyIG92ZXIgdGhlIHNtYWxsZXIgb2YgdHdvIGJsb29tIGZpbHRlcnMuXG4vLyBUaGUgaW5wdXQgZmlsdGVyIG11c3QgaGF2ZSB0aGUgc2FtZSBzaXplIGFuZCBoYXNoIGNvdW50LlxuLy8gT3RoZXJ3aXNlLCB0aGlzIG1ldGhvZCB3aWxsIHRocm93IGFuIGVycm9yLlxucHJvdG8uY292ZXIgPSBmdW5jdGlvbihiZikge1xuICByZXR1cm4gdGhpcy5fZXN0aW1hdGUoYmYsIGZ1bmN0aW9uKGEsIGIsIHVuaW9uKSB7XG4gICAgcmV0dXJuIChhICsgYiAtIHVuaW9uKSAvIE1hdGgubWF4KGEsIGIpO1xuICB9KTtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBmaWx0ZXIuXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICBkZXB0aDogdGhpcy5fZCxcbiAgICBiaXRzOiBbXS5zbGljZS5jYWxsKHRoaXMuX2J1Y2tldHMpXG4gIH07XG59O1xuXG4vLyBodHRwOi8vZ3JhcGhpY3Muc3RhbmZvcmQuZWR1L35zZWFuZGVyL2JpdGhhY2tzLmh0bWwjQ291bnRCaXRzU2V0UGFyYWxsZWxcbmZ1bmN0aW9uIGJpdGNvdW50KHYpIHtcbiAgdiAtPSAodiA+PiAxKSAmIDB4NTU1NTU1NTU7XG4gIHYgPSAodiAmIDB4MzMzMzMzMzMpICsgKCh2ID4+IDIpICYgMHgzMzMzMzMzMyk7XG4gIHJldHVybiAoKHYgKyAodiA+PiA0KSAmIDB4RjBGMEYwRikgKiAweDEwMTAxMDEpID4+IDI0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb29tRmlsdGVyOyIsIi8vIENvdW50LU1lYW4tTWluIHNrZXRjaGVzIGV4dGVuZCBDb3VudC1NaW4gd2l0aCBpbXByb3ZlZCBlc3RpbWF0aW9uLlxuLy8gU2VlICdOZXcgRXN0aW1hdGlvbiBBbGdvcml0aG1zIGZvciBTdHJlYW1pbmcgRGF0YTogQ291bnQtbWluIENhbiBEbyBNb3JlJ1xuLy8gYnkgRGVuZyAmIFJhZmllaSwgaHR0cDovL3dlYmRvY3MuY3MudWFsYmVydGEuY2EvfmZhbmRlbmcvcGFwZXIvY21tLnBkZlxuXG52YXIgQ291bnRNaW4gPSByZXF1aXJlKCcuL2NvdW50LW1pbicpO1xuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWVhbi1NaW4gc2tldGNoLlxuLy8gSWYgYXJndW1lbnQgKncqIGlzIGFuIGFycmF5LWxpa2Ugb2JqZWN0LCB3aXRoIGEgbGVuZ3RoIHByb3BlcnR5LCB0aGVuIHRoZVxuLy8gc2tldGNoIGlzIGxvYWRlZCB3aXRoIGRhdGEgZnJvbSB0aGUgYXJyYXksIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLlxuLy8gT3RoZXJ3aXNlLCAqdyogc3BlY2lmaWVzIHRoZSB3aWR0aCAobnVtYmVyIG9mIHJvdyBlbnRyaWVzKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKmQqIHNwZWNpZmllcyB0aGUgZGVwdGggKG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpudW0qIGluZGljYXRlcyB0aGUgbnVtYmVyIG9mIGVsZW1lbnRzIGFkZC4gVGhpcyBzaG91bGQgb25seSBiZVxuLy8gcHJvdmlkZWQgaWYgKncqIGlzIGFuIGFycmF5LCBpbiB3aGljaCBjYXNlICpudW0qIGlzIHJlcXVpcmVkLlxuZnVuY3Rpb24gQ291bnRNZWFuTWluKHcsIGQsIG51bSkge1xuICBDb3VudE1pbi5jYWxsKHRoaXMsIHcsIGQsIG51bSk7XG4gIHRoaXMuX3EgPSBBcnJheShkKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggYmFzZWQgb24gcHJvdmlkZWQgcGVyZm9ybWFuY2UgcGFyYW1ldGVycy5cbi8vIEFyZ3VtZW50ICpuKiBpcyB0aGUgZXhwZWN0ZWQgY291bnQgb2YgYWxsIGVsZW1lbnRzXG4vLyBBcmd1bWVudCAqZSogaXMgdGhlIGFjY2VwdGFibGUgYWJzb2x1dGUgZXJyb3IuXG4vLyBBcmd1bWVudCAqcCogaXMgdGhlIHByb2JhYmlsaXR5IG9mIG5vdCBhY2hpZXZpbmcgdGhlIGVycm9yIGJvdW5kLlxuQ291bnRNZWFuTWluLmNyZWF0ZSA9IENvdW50TWluLmNyZWF0ZTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1lYW4tTWluIHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5Db3VudE1lYW5NaW4uaW1wb3J0ID0gQ291bnRNaW4uaW1wb3J0O1xuXG52YXIgcHJvdG8gPSAoQ291bnRNZWFuTWluLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoQ291bnRNaW4ucHJvdG90eXBlKSk7XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICBxID0gdGhpcy5fcSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBuID0gdGhpcy5fbnVtLFxuICAgICAgcyA9IDEgLyAody0xKSxcbiAgICAgIG1pbiA9ICtJbmZpbml0eSwgYywgaSwgcjtcblxuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIGMgPSB0W3IgKyBsW2ldXTtcbiAgICBpZiAoYyA8IG1pbikgbWluID0gYztcbiAgICBjID0gYyAtIChuLWMpICogcztcbiAgICBxW2ldID0gYztcbiAgfVxuXG4gIHJldHVybiAoYyA9IG1lZGlhbihxKSkgPCAwID8gMCA6IGMgPiBtaW4gPyBtaW4gOiBjO1xufTtcblxuLy8gQXBwcm94aW1hdGUgZG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgaWYgKHRoaXMuX3cgIT09IHRoYXQuX3cpIHRocm93ICdTa2V0Y2ggd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAodGhpcy5fZCAhPT0gdGhhdC5fZCkgdGhyb3cgJ1NrZXRjaCBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIHRhID0gdGhpcy5fdGFibGUsXG4gICAgICB0YiA9IHRoYXQuX3RhYmxlLFxuICAgICAgcSA9IHRoaXMuX3EsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIG4gPSB0aGlzLl9udW0sXG4gICAgICBtID0gdGhpcy5fZCAqIHcsXG4gICAgICB6ID0gKHcgLSAxKSAvIHcsXG4gICAgICBzID0gMSAvICh3LTEpLFxuICAgICAgZG90ID0gMCwgaSA9IDA7XG5cbiAgZG8ge1xuICAgIGRvdCArPSAodGFbaV0gLSAobi10YVtpXSkqcykgKiAodGJbaV0gLSAobi10YltpXSkqcyk7XG4gICAgaWYgKCsraSAlIHcgPT09IDApIHtcbiAgICAgIHFbaS93LTFdID0geiAqIGRvdDtcbiAgICAgIGRvdCA9IDA7XG4gICAgfVxuICB9IHdoaWxlIChpIDwgbSk7XG5cbiAgcmV0dXJuIChkb3QgPSBtZWRpYW4ocSkpIDwgMCA/IDAgOiBkb3Q7XG59O1xuXG5mdW5jdGlvbiBtZWRpYW4ocSkge1xuICBxLnNvcnQobnVtY21wKTtcbiAgdmFyIG4gPSBxLmxlbmd0aCxcbiAgICAgIGggPSB+fihuLzIpO1xuICByZXR1cm4gbiAlIDIgPyBxW2hdIDogMC41ICogKHFbaC0xXSArIHFbaF0pO1xufVxuXG5mdW5jdGlvbiBudW1jbXAoYSwgYikge1xuICByZXR1cm4gYSAtIGI7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQ291bnRNZWFuTWluO1xuIiwidmFyIGhhc2ggPSByZXF1aXJlKCcuL2hhc2gnKTtcblxudmFyIFRZUEVEX0FSUkFZUyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIixcbiAgICBERUZBVUxUX0JJTlMgPSAyNzE5MSxcbiAgICBERUZBVUxUX0hBU0ggPSA5O1xuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWluIHNrZXRjaCBmb3IgYXBwcm94aW1hdGUgY291bnRzIG9mIHZhbHVlIGZyZXF1ZW5jaWVzLlxuLy8gU2VlOiAnQW4gSW1wcm92ZWQgRGF0YSBTdHJlYW0gU3VtbWFyeTogVGhlIENvdW50LU1pbiBTa2V0Y2ggYW5kIGl0c1xuLy8gQXBwbGljYXRpb25zJyBieSBHLiBDb3Jtb2RlICYgUy4gTXV0aHVrcmlzaG5hbi5cbi8vIElmIGFyZ3VtZW50ICp3KiBpcyBhbiBhcnJheS1saWtlIG9iamVjdCwgd2l0aCBhIGxlbmd0aCBwcm9wZXJ0eSwgdGhlbiB0aGVcbi8vIHNrZXRjaCBpcyBsb2FkZWQgd2l0aCBkYXRhIGZyb20gdGhlIGFycmF5LCBlYWNoIGVsZW1lbnQgaXMgYSAzMi1iaXQgaW50ZWdlci5cbi8vIE90aGVyd2lzZSwgKncqIHNwZWNpZmllcyB0aGUgd2lkdGggKG51bWJlciBvZiByb3cgZW50cmllcykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpkKiBzcGVjaWZpZXMgdGhlIGRlcHRoIChudW1iZXIgb2YgaGFzaCBmdW5jdGlvbnMpIG9mIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqbnVtKiBpbmRpY2F0ZXMgdGhlIG51bWJlciBvZiBlbGVtZW50cyBhZGQuIFRoaXMgc2hvdWxkIG9ubHkgYmVcbi8vIHByb3ZpZGVkIGlmICp3KiBpcyBhbiBhcnJheSwgaW4gd2hpY2ggY2FzZSAqbnVtKiBpcyByZXF1aXJlZC5cbmZ1bmN0aW9uIENvdW50TWluKHcsIGQsIG51bSkge1xuICB3ID0gdyB8fCBERUZBVUxUX0JJTlM7XG4gIGQgPSBkIHx8IERFRkFVTFRfSEFTSDtcblxuICB2YXIgYSwgdCwgaT0tMSwgbjtcbiAgaWYgKHR5cGVvZiB3ICE9PSBcIm51bWJlclwiKSB7IGEgPSB3OyB3ID0gYS5sZW5ndGggLyBkOyB9XG4gIHRoaXMuX3cgPSB3O1xuICB0aGlzLl9kID0gZDtcbiAgdGhpcy5fbnVtID0gbnVtIHx8IDA7XG4gIG4gPSB3ICogZDtcblxuICBpZiAoVFlQRURfQVJSQVlTKSB7XG4gICAgdCA9IHRoaXMuX3RhYmxlID0gbmV3IEludDMyQXJyYXkobik7XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSB0W2ldID0gYVtpXTtcbiAgfSBlbHNlIHtcbiAgICB0ID0gdGhpcy5fdGFibGUgPSBBcnJheShuKTtcbiAgICBpZiAoYSkgd2hpbGUgKCsraSA8IG4pIHRbaV0gPSBhW2ldO1xuICAgIHdoaWxlICgrK2kgPCBuKSB0W2ldID0gMDtcbiAgfVxuICBoYXNoLmluaXQuY2FsbCh0aGlzKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggYmFzZWQgb24gcHJvdmlkZWQgcGVyZm9ybWFuY2UgcGFyYW1ldGVycy5cbi8vIEFyZ3VtZW50ICpuKiBpcyB0aGUgZXhwZWN0ZWQgY291bnQgb2YgYWxsIGVsZW1lbnRzXG4vLyBBcmd1bWVudCAqZSogaXMgdGhlIGFjY2VwdGFibGUgYWJzb2x1dGUgZXJyb3IuXG4vLyBBcmd1bWVudCAqcCogaXMgdGhlIHByb2JhYmlsaXR5IG9mIG5vdCBhY2hpZXZpbmcgdGhlIGVycm9yIGJvdW5kLlxuLy8gaHR0cDovL2RpbWFjcy5ydXRnZXJzLmVkdS9+Z3JhaGFtL3B1YnMvcGFwZXJzL2NtZW5jeWMucGRmXG5Db3VudE1pbi5jcmVhdGUgPSBmdW5jdGlvbihuLCBlLCBwKSB7XG4gIGUgPSBuID8gKGUgPyBlL24gOiAxL24pIDogMC4wMDE7XG4gIHAgPSBwIHx8IDAuMDAxO1xuICB2YXIgdyA9IE1hdGguY2VpbChNYXRoLkUgLyBlKSxcbiAgICAgIGQgPSBNYXRoLmNlaWwoLU1hdGgubG9nKHApKTtcbiAgcmV0dXJuIG5ldyB0aGlzKHcsIGQpO1xufTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQ291bnRNaW4uaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgdGhpcyhvYmouY291bnRzLCBvYmouZGVwdGgsIG9iai5udW0pO1xufTtcblxudmFyIHByb3RvID0gQ291bnRNaW4ucHJvdG90eXBlO1xuXG5wcm90by5sb2NhdGlvbnMgPSBoYXNoLmxvY2F0aW9ucztcblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIHNrZXRjaC5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgdCA9IHRoaXMuX3RhYmxlLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBkID0gdGhpcy5fZCwgaSwgcjtcbiAgZm9yIChpPTAsIHI9MDsgaTxkOyArK2ksIHIrPXcpIHtcbiAgICB0W3IgKyBsW2ldXSArPSAxO1xuICB9XG4gIHRoaXMuX251bSArPSAxO1xufTtcblxuLy8gUXVlcnkgZm9yIGFwcHJveGltYXRlIGNvdW50LlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBtaW4gPSArSW5maW5pdHksXG4gICAgICBsID0gdGhpcy5sb2NhdGlvbnModiArICcnKSxcbiAgICAgIHQgPSB0aGlzLl90YWJsZSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsIGksIHIsIGM7XG4gIGZvciAoaT0wLCByPTA7IGk8ZDsgKytpLCByKz13KSB7XG4gICAgYyA9IHRbciArIGxbaV1dO1xuICAgIGlmIChjIDwgbWluKSBtaW4gPSBjO1xuICB9XG4gIHJldHVybiBtaW47XG59O1xuXG4vLyBBcHByb3hpbWF0ZSBkb3QgcHJvZHVjdCB3aXRoIGFub3RoZXIgc2tldGNoLlxuLy8gVGhlIGlucHV0IHNrZXRjaCBtdXN0IGhhdmUgdGhlIHNhbWUgZGVwdGggYW5kIHdpZHRoLlxuLy8gT3RoZXJ3aXNlLCB0aGlzIG1ldGhvZCB3aWxsIHRocm93IGFuIGVycm9yLlxucHJvdG8uZG90ID0gZnVuY3Rpb24odGhhdCkge1xuICBpZiAodGhpcy5fdyAhPT0gdGhhdC5fdykgdGhyb3cgJ1NrZXRjaCB3aWR0aHMgZG8gbm90IG1hdGNoLic7XG4gIGlmICh0aGlzLl9kICE9PSB0aGF0Ll9kKSB0aHJvdyAnU2tldGNoIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgdGEgPSB0aGlzLl90YWJsZSxcbiAgICAgIHRiID0gdGhhdC5fdGFibGUsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIG0gPSB0aGlzLl9kICogdyxcbiAgICAgIG1pbiA9ICtJbmZpbml0eSxcbiAgICAgIGRvdCA9IDAsIGkgPSAwO1xuXG4gIGRvIHtcbiAgICBkb3QgKz0gdGFbaV0gKiB0YltpXTtcbiAgICBpZiAoKytpICUgdyA9PT0gMCkge1xuICAgICAgaWYgKGRvdCA8IG1pbikgbWluID0gZG90O1xuICAgICAgZG90ID0gMDtcbiAgICB9XG4gIH0gd2hpbGUgKGkgPCBtKTtcblxuICByZXR1cm4gbWluO1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIHNrZXRjaC5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIG51bTogdGhpcy5fbnVtLFxuICAgIGRlcHRoOiB0aGlzLl9kLFxuICAgIGNvdW50czogW10uc2xpY2UuY2FsbCh0aGlzLl90YWJsZSlcbiAgfTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ291bnRNaW47XG4iLCJ2YXIgVFlQRURfQVJSQVlTID0gdHlwZW9mIEFycmF5QnVmZmVyICE9PSBcInVuZGVmaW5lZFwiO1xuXG4vLyBGb3dsZXIvTm9sbC9WbyBoYXNoaW5nLlxuZnVuY3Rpb24gZm52XzFhKHYpIHtcbiAgdmFyIG4gPSB2Lmxlbmd0aCxcbiAgICAgIGEgPSAyMTY2MTM2MjYxLFxuICAgICAgYyxcbiAgICAgIGQsXG4gICAgICBpID0gLTE7XG4gIHdoaWxlICgrK2kgPCBuKSB7XG4gICAgYyA9IHYuY2hhckNvZGVBdChpKTtcbiAgICBpZiAoKGQgPSBjICYgMHhmZjAwMDAwMCkpIHtcbiAgICAgIGEgXj0gZCA+PiAyNDtcbiAgICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gICAgfVxuICAgIGlmICgoZCA9IGMgJiAweGZmMDAwMCkpIHtcbiAgICAgIGEgXj0gZCA+PiAxNjtcbiAgICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gICAgfVxuICAgIGlmICgoZCA9IGMgJiAweGZmMDApKSB7XG4gICAgICBhIF49IGQgPj4gODtcbiAgICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gICAgfVxuICAgIGEgXj0gYyAmIDB4ZmY7XG4gICAgYSArPSAoYSA8PCAxKSArIChhIDw8IDQpICsgKGEgPDwgNykgKyAoYSA8PCA4KSArIChhIDw8IDI0KTtcbiAgfVxuICAvLyBGcm9tIGh0dHA6Ly9ob21lLmNvbWNhc3QubmV0L35icmV0bS9oYXNoLzYuaHRtbFxuICBhICs9IGEgPDwgMTM7XG4gIGEgXj0gYSA+PiA3O1xuICBhICs9IGEgPDwgMztcbiAgYSBePSBhID4+IDE3O1xuICBhICs9IGEgPDwgNTtcbiAgcmV0dXJuIGEgJiAweGZmZmZmZmZmO1xufVxuXG4vLyBPbmUgYWRkaXRpb25hbCBpdGVyYXRpb24gb2YgRk5WLCBnaXZlbiBhIGhhc2guXG5mdW5jdGlvbiBmbnZfMWFfYihhKSB7XG4gIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gIGEgKz0gYSA8PCAxMztcbiAgYSBePSBhID4+IDc7XG4gIGEgKz0gYSA8PCAzO1xuICBhIF49IGEgPj4gMTc7XG4gIGEgKz0gYSA8PCA1O1xuICByZXR1cm4gYSAmIDB4ZmZmZmZmZmY7XG59XG5cbi8vIG1peC1pbiBtZXRob2QgZm9yIG11bHRpLWhhc2ggaW5pdGlhbGl6YXRpb25cbm1vZHVsZS5leHBvcnRzLmluaXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGQgPSB0aGlzLl9kLFxuICAgICAgdyA9IHRoaXMuX3c7XG5cbiAgaWYgKFRZUEVEX0FSUkFZUykge1xuICAgIHZhciBrYnl0ZXMgPSAxIDw8IE1hdGguY2VpbChNYXRoLmxvZyhcbiAgICAgICAgICBNYXRoLmNlaWwoTWF0aC5sb2codykgLyBNYXRoLkxOMiAvIDgpXG4gICAgICAgICkgLyBNYXRoLkxOMiksXG4gICAgICAgIGFycmF5ID0ga2J5dGVzID09PSAxID8gVWludDhBcnJheSA6IGtieXRlcyA9PT0gMiA/IFVpbnQxNkFycmF5IDogVWludDMyQXJyYXksXG4gICAgICAgIGtidWZmZXIgPSBuZXcgQXJyYXlCdWZmZXIoa2J5dGVzICogZCk7XG4gICAgdGhpcy5fbG9jYXRpb25zID0gbmV3IGFycmF5KGtidWZmZXIpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuX2xvY2F0aW9ucyA9IFtdO1xuICB9XG59O1xuXG4vLyBtaXgtaW4gbWV0aG9kIGZvciBtdWx0aS1oYXNoIGNhbGN1bGF0aW9uXG4vLyBTZWUgaHR0cDovL3dpbGx3aGltLndvcmRwcmVzcy5jb20vMjAxMS8wOS8wMy9wcm9kdWNpbmctbi1oYXNoLWZ1bmN0aW9ucy1ieS1oYXNoaW5nLW9ubHktb25jZS9cbm1vZHVsZS5leHBvcnRzLmxvY2F0aW9ucyA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGQgPSB0aGlzLl9kLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICByID0gdGhpcy5fbG9jYXRpb25zLFxuICAgICAgYSA9IGZudl8xYSh2KSxcbiAgICAgIGIgPSBmbnZfMWFfYihhKSxcbiAgICAgIGkgPSAtMSxcbiAgICAgIHggPSBhICUgdztcbiAgd2hpbGUgKCsraSA8IGQpIHtcbiAgICByW2ldID0geCA8IDAgPyAoeCArIHcpIDogeDtcbiAgICB4ID0gKHggKyBiKSAlIHc7XG4gIH1cbiAgcmV0dXJuIHI7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5mbnZfMWEgPSBmbnZfMWE7XG5tb2R1bGUuZXhwb3J0cy5mbnZfMWFfYiA9IGZudl8xYV9iO1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gIEJsb29tOiAgICAgICAgcmVxdWlyZSgnLi9ibG9vbScpLFxuICBDb3VudE1pbjogICAgIHJlcXVpcmUoJy4vY291bnQtbWluJyksXG4gIENvdW50TWVhbk1pbjogcmVxdWlyZSgnLi9jb3VudC1tZWFuLW1pbicpLFxuICBOR3JhbTogICAgICAgIHJlcXVpcmUoJy4vbmdyYW0nKVxufTsiLCIvLyBDcmVhdGUgYSBuZXcgY2hhcmFjdGVyLWxldmVsIG4tZ3JhbSBza2V0Y2guXG4vLyAqbiogaXMgdGhlIG51bWJlciBvZiBjaGFyYWN0ZXJzIHRvIGluY2x1ZGUsIGRlZmF1bHRzIHRvIDIuXG4vLyAqY2FzZVNlbnNpdGl2ZSogaW5kaWNhdGVzIGNhc2Utc2Vuc2l0aXZpdHksIGRlZmF1bHRzIHRvIGZhbHNlLlxuLy8gKm1hcCogaXMgYW4gb3B0aW9uYWwgZXhpc3RpbmcgbmdyYW0gdG8gY291bnQgbWFwLlxuZnVuY3Rpb24gTkdyYW0obiwgY2FzZVNlbnNpdGl2ZSwgbWFwKSB7XG4gIHRoaXMuX24gPSBuID09IG51bGwgPyAyIDogbjtcbiAgdGhpcy5fY2FzZSA9ICEhY2FzZVNlbnNpdGl2ZTtcbiAgdGhpcy5fbWFwID0gbWFwIHx8IHt9O1xuICB0aGlzLl9ub3JtID0gbnVsbDtcbn1cblxuTkdyYW0uaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgTkdyYW0ob2JqLm4sIG9iai5jYXNlLCBvYmouY291bnRzKTtcbn07XG5cbnZhciBwcm90byA9IE5HcmFtLnByb3RvdHlwZTtcblxuLy8gQWRkIGFsbCBjb25zZWN1dGl2ZSBuLWdyYW1zIGluICpzKiB0byB0aGlzIHNrZXRjaFxucHJvdG8uYWRkID0gZnVuY3Rpb24ocykge1xuICBpZiAocyA9PSBudWxsIHx8IHMgPT09ICcnKSByZXR1cm47XG4gIHRoaXMuX25vcm0gPSBudWxsO1xuICBjb3VudHMoU3RyaW5nKHMpLCB0aGlzLl9uLCB0aGlzLl9jYXNlLCB0aGlzLl9tYXApO1xufTtcblxuLy8gYWRkIGNvdW50cyBvZiBuLWdyYW1zIGluIHN0cmluZyB0byBhIG1hcFxuZnVuY3Rpb24gY291bnRzKHMsIG4sIGMsIG1hcCkge1xuICB2YXIgbGVuID0gcy5sZW5ndGggLSBuICsgMSxcbiAgICAgIGssIGk7XG4gIFxuICBmb3IgKGk9MDsgaTxsZW47ICsraSkge1xuICAgIGsgPSBzLnN1YnN0cihpLCBuKTtcbiAgICBpZiAoIWMpIGsgPSBrLnRvTG93ZXJDYXNlKCk7XG4gICAgbWFwW2tdID0gbWFwW2tdID8gbWFwW2tdICsgMSA6IDE7XG4gIH1cbn1cblxuLy8gVGhlIG9jY3VycmVuY2UgY291bnQgb2YgYSBnaXZlbiBuLWdyYW0uXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKGtleSkge1xuICByZXR1cm4gdGhpcy5fbWFwW3RoaXMuX2Nhc2UgPyBrZXkgOiBrZXkudG9Mb3dlckNhc2UoKV0gfHwgMDtcbn07XG5cbi8vIFJldHVybiB0aGUgbnVtYmVyIG9mIHVuaXF1ZSBuLWdyYW1zIG9ic2VydmVkLlxucHJvdG8uc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fbWFwKS5sZW5ndGg7XG59O1xuXG4vLyBSZXR1cm4gdGhlIHZlY3RvciBub3JtIG9mIHRoZSBjb3VudHMgaW4gdGhpcyBza2V0Y2guXG5wcm90by5ub3JtID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLl9ub3JtID09IG51bGwpIHtcbiAgICB2YXIgbSA9IHRoaXMuX21hcCxcbiAgICAgICAgcyA9IDAsIGs7XG4gICAgZm9yIChrIGluIG0pIHtcbiAgICAgIHMgKz0gbVtrXSAqIG1ba107XG4gICAgfVxuICAgIHRoaXMuX25vcm0gPSBNYXRoLnNxcnQocyk7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX25vcm07XG59O1xuXG4vLyBEb3QgcHJvZHVjdCB3aXRoIGFub3RoZXIgbi1ncmFtIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggc2hvdWxkIGhhdmUgdGhlIHNhbWUgKm4qIHBhcmFtZXRlci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgdmFyIGEgPSB0aGlzLl9tYXAsXG4gICAgICBiID0gdGhhdC5fbWFwLFxuICAgICAgZG90ID0gMCwgaztcblxuICBmb3IgKGsgaW4gYSkge1xuICAgIGRvdCArPSBhW2tdICogKGJba10gfHwgMCk7XG4gIH1cbiAgXG4gIHJldHVybiBkb3Q7XG59O1xuXG4vLyBDb3NpbmUgc2ltaWxhcml0eSB3aXRoIGFub3RoZXIgbi1ncmFtIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggc2hvdWxkIGhhdmUgdGhlIHNhbWUgKm4qIHBhcmFtZXRlci5cbnByb3RvLmNvc2luZSA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgdmFyIGFhID0gdGhpcy5ub3JtKCksXG4gICAgICBiYiA9IHRoYXQubm9ybSgpO1xuICByZXR1cm4gdGhpcy5kb3QodGhhdCkgLyAoYWEgKiBiYik7XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgc2tldGNoLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgbjogdGhpcy5fbixcbiAgICBjYXNlOiB0aGlzLl9jYXNlLFxuICAgIGNvdW50czogdGhpcy5fbWFwXG4gIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE5HcmFtO1xuIl19
