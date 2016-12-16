(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}(g.dl || (g.dl = {})).sketch = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var TYPED_ARRAYS = typeof ArrayBuffer !== 'undefined';

function floats(n) {
  return new Float64Array(n);
}

function ints(n) {
  return new Int32Array(n);
}

function array(n) {
  var a = Array(n);
  for (var i=0; i<n; ++i) a[i] = 0;
  return a;
}

module.exports = {
  floats: TYPED_ARRAYS ? floats : array,
  ints: TYPED_ARRAYS ? ints : array
};

},{}],2:[function(require,module,exports){
// Bloom Filters test whether an element is a member of a set.
// False positive matches are possible, but false negatives are not.
// See http://en.wikipedia.org/wiki/Bloom_filter

// This code borrows heavily from http://github.com/jasondavies/bloomfilter.js

var arrays = require('./arrays'),
    hash = require('./hash');

var DEFAULT_BITS = 1024 * 1024 * 8, // 1MB
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

  buckets = this._buckets = arrays.ints(n);
  if (a) while (++i < n) buckets[i] = a[i];
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
      z = arrays.ints(n),
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
    return union ? (a + b) / union - 1 : 0;
  });
};

// Set cover over the smaller of two bloom filters.
// The input filter must have the same size and hash count.
// Otherwise, this method will throw an error.
proto.cover = function(bf) {
  return this._estimate(bf, function(a, b, union) {
    var denom = Math.max(a, b);
    return denom ? (a + b - union) / denom : 0;
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

},{"./arrays":1,"./hash":5}],3:[function(require,module,exports){
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
var arrays = require('./arrays'),
    hash = require('./hash');

var DEFAULT_BINS = 27191,
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
  t = this._table = arrays.ints(n);
  if (a) while (++i < n) t[i] = a[i];

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

},{"./arrays":1,"./hash":5}],5:[function(require,module,exports){
var arrays = require('./arrays');

// Fowler/Noll/Vo hashing.
function fnv_1a(v) {
  var a = 2166136261;
  for (var i = 0, n = v.length; i < n; ++i) {
    var c = v.charCodeAt(i),
        d = c & 0xff00;
    if (d) a = fnv_multiply(a ^ d >> 8);
    a = fnv_multiply(a ^ c & 0xff);
  }
  return fnv_mix(a);
}

// a * 16777619 mod 2**32
function fnv_multiply(a) {
  return a + (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
}

// One additional iteration of FNV, given a hash.
function fnv_1a_b(a) {
  return fnv_mix(fnv_multiply(a));
}

// See https://web.archive.org/web/20131019013225/http://home.comcast.net/~bretm/hash/6.html
function fnv_mix(a) {
  a += a << 13;
  a ^= a >>> 7;
  a += a << 3;
  a ^= a >>> 17;
  a += a << 5;
  return a & 0xffffffff;
}

// mix-in method for multi-hash initialization
module.exports.init = function() {
  this._locations = arrays.ints(this._d);
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

},{"./arrays":1}],6:[function(require,module,exports){
module.exports = {
  Bloom:         require('./bloom'),
  CountMin:      require('./count-min'),
  CountMeanMin:  require('./count-mean-min'),
  NGram:         require('./ngram'),
  StreamSummary: require('./stream-summary'),
  TDigest:       require('./t-digest')
};
},{"./bloom":2,"./count-mean-min":3,"./count-min":4,"./ngram":7,"./stream-summary":8,"./t-digest":9}],7:[function(require,module,exports){
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
  return (aa && bb) ? this.dot(that) / (aa * bb) : 0;
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

},{}],8:[function(require,module,exports){
var DEFAULT_COUNTERS = 100;

// Create a new stream summary sketch for tracking frequent values.
// See: 'Efficient Computation of Frequent and Top-k Elements in Data Streams'
// by A. Metwally, D. Agrawal & A. El Abbadi.
// Argument *w* specifies the maximum number of active counters to maintain.
// If not provided, *w* defaults to tracking a maximum of 100 values.
function StreamSummary(w) {
  this._w = w || DEFAULT_COUNTERS;
  this._values = {};

  this._buckets = {count: -1};
  this._buckets.next = this._buckets;
  this._buckets.prev = this._buckets;

  this._size = 0;
}

// Create a new StreamSummary sketch from a serialized object.
StreamSummary.import = function(obj) {
  var ss = new StreamSummary(obj.w),
      bb = ss._buckets,
      i, n, c, b, j, m, e;

  for (i=0, n=obj.buckets.length; i<n; ++i) {
    c = obj.buckets[i];
    b = insert(bb.prev, bucket(c[0]));
    for (j=1, m=c.length; j<m; j+=2) {
      e = insert(b.list.prev, entry(c[j], b));
      e.count = b.count;
      e.error = c[j+1];
      ss._size += 1;
    }
  }
  
  return ss;
};

// Generate a new frequency bucket.
function bucket(count) {
  var b = {count: count};
  b.next = b;
  b.prev = b;
  b.list = {};
  b.list.prev = b.list;
  b.list.next = b.list;
  return b;
}

// Generate a new counter node for a value.
function entry(value, bucket) {
  return {
    bucket: bucket,
    value: value,
    count: 0,
    error: 0
  };
}

// Insert *curr* ahead of linked list node *list*.
function insert(list, curr) {
  var next = list.next;
  curr.next = next;
  curr.prev = list;
  list.next = curr;
  next.prev = curr;
  return curr;
}

// Detach *curr* from its linked list.
function detach(curr) {
  var n = curr.next,
      p = curr.prev;
  p.next = n;
  n.prev = p;
}

var proto = StreamSummary.prototype;

// Add a value to the sketch.
// Argument *v* is the value to add.
// Argument *count* is the optional number of occurrences to register.
// If *count* is not provided, an increment of 1 is assumed.
proto.add = function(v, count) {
  count = count || 1;
  var node = this._values[v], b;

  if (node == null) {
    if (this._size < this._w) {
      b = insert(this._buckets, bucket(0));
      node = insert(b.list, entry(v, b));
      this._size += 1;
    } else {
      b = this._buckets.next;
      node = b.list.next;
      delete this._values[node.value];
      node.value = v;
      node.error = b.count;
    }
    this._values[v] = node;    
  }
  this._increment(node, count);
};

// Increment the count in the stream summary data structure.
proto._increment = function(node, count) {
  var head = this._buckets,
      old  = node.bucket,
      prev = old,
      next = prev.next;

  detach(node);
  node.count += count;

  while (next !== head) {
    if (node.count === next.count) {
      insert(next.list, node);
      break;
    } else if (node.count > next.count) {
      prev = next;
      next = prev.next;
    } else {
      next = head;
    }
  }

  if (next === head) {
    next = bucket(node.count);
    insert(next.list, node); // add value node to bucket
    insert(prev, next);  // add bucket to bucket list
  }
  node.bucket = next;

  // clean up if old bucket is empty
  if (old.list.next === old.list) {
    detach(old);
  }
};

// Query for approximate count for value *v*.
// Returns zero if *v* is not in the sketch.
proto.query = function(v) {
  var node = this._values[v];
  return node ? node.count : 0;
};

// Query for estimation error for value *v*.
// Returns -1 if *v* is not in the sketch.
proto.error = function(v) {
  var node = this._values[v];
  return node ? node.error : -1;
};

// Returns the (approximate) top-k most frequent values,
// returned in order of decreasing frequency.
// All monitored values are returned if *k* is not provided
// or is larger than the sketch size.
proto.values = function(k) {
  return this.collect(k, function(x) { return x.value; });
};

// Returns counts for the (approximate) top-k frequent values,
// returned in order of decreasing frequency.
// All monitored counts are returned if *k* is not provided
// or is larger than the sketch size.
proto.counts = function(k) {
  return this.collect(k, function(x) { return x.count; });
};

// Returns estimation error values for the (approximate) top-k
// frequent values, returned in order of decreasing frequency.
// All monitored counts are returned if *k* is not provided
// or is larger than the sketch size.
proto.errors = function(k) {
  return this.collect(k, function(x) { return x.error; });
};

// Collects values for each entry in the sketch, in order of
// decreasing (approximate) frequency.
// Argument *k* is the number of values to collect. If the *k* is not
// provided or greater than the sketch size, all values are visited.
// Argument *f* is an accessor function for collecting a value.
proto.collect = function(k, f) {
  if (k === 0) return [];
  if (k == null || k < 0) k = this._size;

  var data = Array(k),
      head = this._buckets,
      node, list, entry, i=0;

  for (node = head.prev; node !== head; node = node.prev) {
    list = node.list;
    for (entry = list.prev; entry !== list; entry = entry.prev) {
      data[i++] = f(entry);
      if (i === k) return data;
    }
  }

  return data;
};

// Return a JSON-compatible serialized version of this sketch.
proto.export = function() {
  var head = this._buckets,
      out = [], b, n, c;

  for (b = head.next; b !== head; b = b.next) {
    for (c = [b.count], n = b.list.next; n !== b.list; n = n.next) {
      c.push(n.value, n.error);
    }
    out.push(c);
  }

  return {
    w: this._w,
    buckets: out
  };
};

module.exports = StreamSummary;

},{}],9:[function(require,module,exports){
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
  var td = new TDigest(obj.centroids);
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
proto.export = function() {
  this._mergeValues();
  return {
    centroids: this._nc,
    min:       this._min,
    max:       this._max,
    mean:      [].slice.call(this._mean, 0, this._last+1),
    weight:    [].slice.call(this._weight, 0, this._last+1)
  };
};

module.exports = TDigest;

},{"./arrays":1}]},{},[6])(6)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXJyYXlzLmpzIiwic3JjL2Jsb29tLmpzIiwic3JjL2NvdW50LW1lYW4tbWluLmpzIiwic3JjL2NvdW50LW1pbi5qcyIsInNyYy9oYXNoLmpzIiwic3JjL2luZGV4LmpzIiwic3JjL25ncmFtLmpzIiwic3JjL3N0cmVhbS1zdW1tYXJ5LmpzIiwic3JjL3QtZGlnZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBUWVBFRF9BUlJBWVMgPSB0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnO1xuXG5mdW5jdGlvbiBmbG9hdHMobikge1xuICByZXR1cm4gbmV3IEZsb2F0NjRBcnJheShuKTtcbn1cblxuZnVuY3Rpb24gaW50cyhuKSB7XG4gIHJldHVybiBuZXcgSW50MzJBcnJheShuKTtcbn1cblxuZnVuY3Rpb24gYXJyYXkobikge1xuICB2YXIgYSA9IEFycmF5KG4pO1xuICBmb3IgKHZhciBpPTA7IGk8bjsgKytpKSBhW2ldID0gMDtcbiAgcmV0dXJuIGE7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBmbG9hdHM6IFRZUEVEX0FSUkFZUyA/IGZsb2F0cyA6IGFycmF5LFxuICBpbnRzOiBUWVBFRF9BUlJBWVMgPyBpbnRzIDogYXJyYXlcbn07XG4iLCIvLyBCbG9vbSBGaWx0ZXJzIHRlc3Qgd2hldGhlciBhbiBlbGVtZW50IGlzIGEgbWVtYmVyIG9mIGEgc2V0LlxuLy8gRmFsc2UgcG9zaXRpdmUgbWF0Y2hlcyBhcmUgcG9zc2libGUsIGJ1dCBmYWxzZSBuZWdhdGl2ZXMgYXJlIG5vdC5cbi8vIFNlZSBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jsb29tX2ZpbHRlclxuXG4vLyBUaGlzIGNvZGUgYm9ycm93cyBoZWF2aWx5IGZyb20gaHR0cDovL2dpdGh1Yi5jb20vamFzb25kYXZpZXMvYmxvb21maWx0ZXIuanNcblxudmFyIGFycmF5cyA9IHJlcXVpcmUoJy4vYXJyYXlzJyksXG4gICAgaGFzaCA9IHJlcXVpcmUoJy4vaGFzaCcpO1xuXG52YXIgREVGQVVMVF9CSVRTID0gMTAyNCAqIDEwMjQgKiA4LCAvLyAxTUJcbiAgICBERUZBVUxUX0hBU0ggPSA1OyAvLyBPcHRpbWFsIGZvciAyJSBGUFIgb3ZlciAxTSBlbGVtZW50c1xuXG4vLyBDcmVhdGUgYSBuZXcgYmxvb20gZmlsdGVyLiBJZiAqdyogaXMgYW4gYXJyYXktbGlrZSBvYmplY3QsIHdpdGggYSBsZW5ndGhcbi8vIHByb3BlcnR5LCB0aGVuIHRoZSBibG9vbSBmaWx0ZXIgaXMgbG9hZGVkIHdpdGggZGF0YSBmcm9tIHRoZSBhcnJheSwgd2hlcmVcbi8vIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLiBPdGhlcndpc2UsICp3KiBzaG91bGQgc3BlY2lmeSB0aGUgd2lkdGhcbi8vIG9mIHRoZSBmaWx0ZXIgaW4gYml0cy4gTm90ZSB0aGF0ICp3KiBpcyByb3VuZGVkIHVwIHRvIHRoZSBuZWFyZXN0IG11bHRpcGxlXG4vLyBvZiAzMi4gKmQqICh0aGUgZmlsdGVyIGRlcHRoKSBzcGVjaWZpZXMgdGhlIG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucy5cbmZ1bmN0aW9uIEJsb29tRmlsdGVyKHcsIGQpIHtcbiAgdyA9IHcgfHwgREVGQVVMVF9CSVRTO1xuICBkID0gZCB8fCBERUZBVUxUX0hBU0g7XG5cbiAgdmFyIGE7XG4gIGlmICh0eXBlb2YgdyAhPT0gXCJudW1iZXJcIikgeyBhID0gdzsgdyA9IGEubGVuZ3RoICogMzI7IH1cblxuICB2YXIgbiA9IE1hdGguY2VpbCh3IC8gMzIpLFxuICAgICAgaSA9IC0xLCBidWNrZXRzO1xuICB0aGlzLl93ID0gdyA9IG4gKiAzMjtcbiAgdGhpcy5fZCA9IGQ7XG5cbiAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMgPSBhcnJheXMuaW50cyhuKTtcbiAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gYVtpXTtcbiAgaGFzaC5pbml0LmNhbGwodGhpcyk7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIgYmFzZWQgb24gcHJvdmlkZWQgcGVyZm9ybWFuY2UgcGFyYW1ldGVycy5cbi8vIEFyZ3VtZW50ICpuKiBpcyB0aGUgZXhwZWN0ZWQgc2V0IHNpemUgKGNhcmRpbmFsaXR5KS5cbi8vIEFyZ3VtZW50ICpwKiBpcyB0aGUgZGVzaXJlZCBmYWxzZSBwb3NpdGl2ZSByYXRlLlxuLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9CbG9vbV9maWx0ZXIjT3B0aW1hbF9udW1iZXJfb2ZfaGFzaF9mdW5jdGlvbnNcbkJsb29tRmlsdGVyLmNyZWF0ZSA9IGZ1bmN0aW9uKG4sIHApIHtcbiAgdmFyIHcgPSAtbiAqIE1hdGgubG9nKHApIC8gKE1hdGguTE4yICogTWF0aC5MTjIpLFxuICAgICAgZCA9ICh3IC8gbikgKiBNYXRoLkxOMjtcbiAgcmV0dXJuIG5ldyBCbG9vbUZpbHRlcih+fncsIH5+ZCk7XG59O1xuXG4vLyBDcmVhdGUgYSBuZXcgYmxvb20gZmlsdGVyIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdC5cbkJsb29tRmlsdGVyLmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKG9iai5iaXRzLCBvYmouZGVwdGgpO1xufTtcblxudmFyIHByb3RvID0gQmxvb21GaWx0ZXIucHJvdG90eXBlO1xuXG5wcm90by5sb2NhdGlvbnMgPSBoYXNoLmxvY2F0aW9ucztcblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIGZpbHRlci5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBidWNrZXRzID0gdGhpcy5fYnVja2V0cztcbiAgd2hpbGUgKCsraSA8IGQpIGJ1Y2tldHNbTWF0aC5mbG9vcihsW2ldIC8gMzIpXSB8PSAxIDw8IChsW2ldICUgMzIpO1xufTtcblxuLy8gUXVlcnkgZm9yIGluY2x1c2lvbiBpbiB0aGUgZmlsdGVyLlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModiArICcnKSxcbiAgICAgIGkgPSAtMSxcbiAgICAgIGQgPSB0aGlzLl9kLFxuICAgICAgYixcbiAgICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzO1xuICB3aGlsZSAoKytpIDwgZCkge1xuICAgIGIgPSBsW2ldO1xuICAgIGlmICgoYnVja2V0c1tNYXRoLmZsb29yKGIgLyAzMildICYgKDEgPDwgKGIgJSAzMikpKSA9PT0gMCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEVzdGltYXRlZCBjYXJkaW5hbGl0eS5cbnByb3RvLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgYml0cyA9IDAsIGksIG47XG4gIGZvciAoaT0wLCBuPWJ1Y2tldHMubGVuZ3RoOyBpPG47ICsraSkgYml0cyArPSBiaXRjb3VudChidWNrZXRzW2ldKTtcbiAgcmV0dXJuIC10aGlzLl93ICogTWF0aC5sb2coMSAtIGJpdHMgLyB0aGlzLl93KSAvIHRoaXMuX2Q7XG59O1xuXG4vLyBVbmlvbiB0aGlzIGJsb29tIGZpbHRlciB3aXRoIGFub3RoZXIuXG4vLyBUaGUgaW5wdXQgZmlsdGVyIG11c3QgaGF2ZSB0aGUgc2FtZSBkZXB0aCBhbmQgd2lkdGguXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by51bmlvbiA9IGZ1bmN0aW9uKGJmKSB7XG4gIGlmIChiZi5fdyAhPT0gdGhpcy5fdykgdGhyb3cgJ0ZpbHRlciB3aWR0aHMgZG8gbm90IG1hdGNoLic7XG4gIGlmIChiZi5fZCAhPT0gdGhpcy5fZCkgdGhyb3cgJ0ZpbHRlciBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIGEgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgYiA9IGJmLl9idWNrZXRzLFxuICAgICAgbiA9IGEubGVuZ3RoLFxuICAgICAgeiA9IGFycmF5cy5pbnRzKG4pLFxuICAgICAgaTtcblxuICBmb3IgKGk9MDsgaTxuOyArK2kpIHtcbiAgICB6W2ldID0gYVtpXSB8IGJbaV07XG4gIH1cbiAgcmV0dXJuIG5ldyBCbG9vbUZpbHRlcih6LCB0aGlzLl9kKTtcbn07XG5cbi8vIEludGVybmFsIGhlbHBlciBtZXRob2QgZm9yIGJsb29tIGZpbHRlciBjb21wYXJpc29uIGVzdGltYXRlcy5cbnByb3RvLl9lc3RpbWF0ZSA9IGZ1bmN0aW9uKGJmLCBrZXJuZWwpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB4LCB5LCB6LCBpO1xuXG4gIGZvciAoaT14PXk9ej0wOyBpPG47ICsraSkge1xuICAgIHggKz0gYml0Y291bnQoYVtpXSk7XG4gICAgeSArPSBiaXRjb3VudChiW2ldKTtcbiAgICB6ICs9IGJpdGNvdW50KGFbaV0gfCBiW2ldKTtcbiAgfVxuICB4ID0gTWF0aC5sb2coMSAtIHggLyB0aGlzLl93KTtcbiAgeSA9IE1hdGgubG9nKDEgLSB5IC8gdGhpcy5fdyk7XG4gIHogPSBNYXRoLmxvZygxIC0geiAvIHRoaXMuX3cpO1xuICByZXR1cm4ga2VybmVsKHgsIHksIHopO1xufTtcblxuLy8gSmFjY2FyZCBjby1lZmZpY2llbnQgb2YgdHdvIGJsb29tIGZpbHRlcnMuXG4vLyBUaGUgaW5wdXQgZmlsdGVyIG11c3QgaGF2ZSB0aGUgc2FtZSBzaXplIGFuZCBoYXNoIGNvdW50LlxuLy8gT3RoZXJ3aXNlLCB0aGlzIG1ldGhvZCB3aWxsIHRocm93IGFuIGVycm9yLlxucHJvdG8uamFjY2FyZCA9IGZ1bmN0aW9uKGJmKSB7XG4gIHJldHVybiB0aGlzLl9lc3RpbWF0ZShiZiwgZnVuY3Rpb24oYSwgYiwgdW5pb24pIHtcbiAgICByZXR1cm4gdW5pb24gPyAoYSArIGIpIC8gdW5pb24gLSAxIDogMDtcbiAgfSk7XG59O1xuXG4vLyBTZXQgY292ZXIgb3ZlciB0aGUgc21hbGxlciBvZiB0d28gYmxvb20gZmlsdGVycy5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIHNpemUgYW5kIGhhc2ggY291bnQuXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5jb3ZlciA9IGZ1bmN0aW9uKGJmKSB7XG4gIHJldHVybiB0aGlzLl9lc3RpbWF0ZShiZiwgZnVuY3Rpb24oYSwgYiwgdW5pb24pIHtcbiAgICB2YXIgZGVub20gPSBNYXRoLm1heChhLCBiKTtcbiAgICByZXR1cm4gZGVub20gPyAoYSArIGIgLSB1bmlvbikgLyBkZW5vbSA6IDA7XG4gIH0pO1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIGZpbHRlci5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIGRlcHRoOiB0aGlzLl9kLFxuICAgIGJpdHM6IFtdLnNsaWNlLmNhbGwodGhpcy5fYnVja2V0cylcbiAgfTtcbn07XG5cbi8vIGh0dHA6Ly9ncmFwaGljcy5zdGFuZm9yZC5lZHUvfnNlYW5kZXIvYml0aGFja3MuaHRtbCNDb3VudEJpdHNTZXRQYXJhbGxlbFxuZnVuY3Rpb24gYml0Y291bnQodikge1xuICB2IC09ICh2ID4+IDEpICYgMHg1NTU1NTU1NTtcbiAgdiA9ICh2ICYgMHgzMzMzMzMzMykgKyAoKHYgPj4gMikgJiAweDMzMzMzMzMzKTtcbiAgcmV0dXJuICgodiArICh2ID4+IDQpICYgMHhGMEYwRjBGKSAqIDB4MTAxMDEwMSkgPj4gMjQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQmxvb21GaWx0ZXI7XG4iLCIvLyBDb3VudC1NZWFuLU1pbiBza2V0Y2hlcyBleHRlbmQgQ291bnQtTWluIHdpdGggaW1wcm92ZWQgZXN0aW1hdGlvbi5cbi8vIFNlZSAnTmV3IEVzdGltYXRpb24gQWxnb3JpdGhtcyBmb3IgU3RyZWFtaW5nIERhdGE6IENvdW50LW1pbiBDYW4gRG8gTW9yZSdcbi8vIGJ5IERlbmcgJiBSYWZpZWksIGh0dHA6Ly93ZWJkb2NzLmNzLnVhbGJlcnRhLmNhL35mYW5kZW5nL3BhcGVyL2NtbS5wZGZcblxudmFyIENvdW50TWluID0gcmVxdWlyZSgnLi9jb3VudC1taW4nKTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1lYW4tTWluIHNrZXRjaC5cbi8vIElmIGFyZ3VtZW50ICp3KiBpcyBhbiBhcnJheS1saWtlIG9iamVjdCwgd2l0aCBhIGxlbmd0aCBwcm9wZXJ0eSwgdGhlbiB0aGVcbi8vIHNrZXRjaCBpcyBsb2FkZWQgd2l0aCBkYXRhIGZyb20gdGhlIGFycmF5LCBlYWNoIGVsZW1lbnQgaXMgYSAzMi1iaXQgaW50ZWdlci5cbi8vIE90aGVyd2lzZSwgKncqIHNwZWNpZmllcyB0aGUgd2lkdGggKG51bWJlciBvZiByb3cgZW50cmllcykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpkKiBzcGVjaWZpZXMgdGhlIGRlcHRoIChudW1iZXIgb2YgaGFzaCBmdW5jdGlvbnMpIG9mIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqbnVtKiBpbmRpY2F0ZXMgdGhlIG51bWJlciBvZiBlbGVtZW50cyBhZGQuIFRoaXMgc2hvdWxkIG9ubHkgYmVcbi8vIHByb3ZpZGVkIGlmICp3KiBpcyBhbiBhcnJheSwgaW4gd2hpY2ggY2FzZSAqbnVtKiBpcyByZXF1aXJlZC5cbmZ1bmN0aW9uIENvdW50TWVhbk1pbih3LCBkLCBudW0pIHtcbiAgQ291bnRNaW4uY2FsbCh0aGlzLCB3LCBkLCBudW0pO1xuICB0aGlzLl9xID0gQXJyYXkoZCk7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGJhc2VkIG9uIHByb3ZpZGVkIHBlcmZvcm1hbmNlIHBhcmFtZXRlcnMuXG4vLyBBcmd1bWVudCAqbiogaXMgdGhlIGV4cGVjdGVkIGNvdW50IG9mIGFsbCBlbGVtZW50c1xuLy8gQXJndW1lbnQgKmUqIGlzIHRoZSBhY2NlcHRhYmxlIGFic29sdXRlIGVycm9yLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBwcm9iYWJpbGl0eSBvZiBub3QgYWNoaWV2aW5nIHRoZSBlcnJvciBib3VuZC5cbkNvdW50TWVhbk1pbi5jcmVhdGUgPSBDb3VudE1pbi5jcmVhdGU7XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NZWFuLU1pbiBza2V0Y2ggZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQ291bnRNZWFuTWluLmltcG9ydCA9IENvdW50TWluLmltcG9ydDtcblxudmFyIHByb3RvID0gKENvdW50TWVhbk1pbi5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKENvdW50TWluLnByb3RvdHlwZSkpO1xuXG4vLyBRdWVyeSBmb3IgYXBwcm94aW1hdGUgY291bnQuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgdCA9IHRoaXMuX3RhYmxlLFxuICAgICAgcSA9IHRoaXMuX3EsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLFxuICAgICAgbiA9IHRoaXMuX251bSxcbiAgICAgIHMgPSAxIC8gKHctMSksXG4gICAgICBtaW4gPSArSW5maW5pdHksIGMsIGksIHI7XG5cbiAgZm9yIChpPTAsIHI9MDsgaTxkOyArK2ksIHIrPXcpIHtcbiAgICBjID0gdFtyICsgbFtpXV07XG4gICAgaWYgKGMgPCBtaW4pIG1pbiA9IGM7XG4gICAgYyA9IGMgLSAobi1jKSAqIHM7XG4gICAgcVtpXSA9IGM7XG4gIH1cblxuICByZXR1cm4gKGMgPSBtZWRpYW4ocSkpIDwgMCA/IDAgOiBjID4gbWluID8gbWluIDogYztcbn07XG5cbi8vIEFwcHJveGltYXRlIGRvdCBwcm9kdWN0IHdpdGggYW5vdGhlciBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIG11c3QgaGF2ZSB0aGUgc2FtZSBkZXB0aCBhbmQgd2lkdGguXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gIGlmICh0aGlzLl93ICE9PSB0aGF0Ll93KSB0aHJvdyAnU2tldGNoIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKHRoaXMuX2QgIT09IHRoYXQuX2QpIHRocm93ICdTa2V0Y2ggZGVwdGhzIGRvIG5vdCBtYXRjaC4nO1xuXG4gIHZhciB0YSA9IHRoaXMuX3RhYmxlLFxuICAgICAgdGIgPSB0aGF0Ll90YWJsZSxcbiAgICAgIHEgPSB0aGlzLl9xLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBuID0gdGhpcy5fbnVtLFxuICAgICAgbSA9IHRoaXMuX2QgKiB3LFxuICAgICAgeiA9ICh3IC0gMSkgLyB3LFxuICAgICAgcyA9IDEgLyAody0xKSxcbiAgICAgIGRvdCA9IDAsIGkgPSAwO1xuXG4gIGRvIHtcbiAgICBkb3QgKz0gKHRhW2ldIC0gKG4tdGFbaV0pKnMpICogKHRiW2ldIC0gKG4tdGJbaV0pKnMpO1xuICAgIGlmICgrK2kgJSB3ID09PSAwKSB7XG4gICAgICBxW2kvdy0xXSA9IHogKiBkb3Q7XG4gICAgICBkb3QgPSAwO1xuICAgIH1cbiAgfSB3aGlsZSAoaSA8IG0pO1xuXG4gIHJldHVybiAoZG90ID0gbWVkaWFuKHEpKSA8IDAgPyAwIDogZG90O1xufTtcblxuZnVuY3Rpb24gbWVkaWFuKHEpIHtcbiAgcS5zb3J0KG51bWNtcCk7XG4gIHZhciBuID0gcS5sZW5ndGgsXG4gICAgICBoID0gfn4obi8yKTtcbiAgcmV0dXJuIG4gJSAyID8gcVtoXSA6IDAuNSAqIChxW2gtMV0gKyBxW2hdKTtcbn1cblxuZnVuY3Rpb24gbnVtY21wKGEsIGIpIHtcbiAgcmV0dXJuIGEgLSBiO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IENvdW50TWVhbk1pbjtcbiIsInZhciBhcnJheXMgPSByZXF1aXJlKCcuL2FycmF5cycpLFxuICAgIGhhc2ggPSByZXF1aXJlKCcuL2hhc2gnKTtcblxudmFyIERFRkFVTFRfQklOUyA9IDI3MTkxLFxuICAgIERFRkFVTFRfSEFTSCA9IDk7XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGZvciBhcHByb3hpbWF0ZSBjb3VudHMgb2YgdmFsdWUgZnJlcXVlbmNpZXMuXG4vLyBTZWU6ICdBbiBJbXByb3ZlZCBEYXRhIFN0cmVhbSBTdW1tYXJ5OiBUaGUgQ291bnQtTWluIFNrZXRjaCBhbmQgaXRzXG4vLyBBcHBsaWNhdGlvbnMnIGJ5IEcuIENvcm1vZGUgJiBTLiBNdXRodWtyaXNobmFuLlxuLy8gSWYgYXJndW1lbnQgKncqIGlzIGFuIGFycmF5LWxpa2Ugb2JqZWN0LCB3aXRoIGEgbGVuZ3RoIHByb3BlcnR5LCB0aGVuIHRoZVxuLy8gc2tldGNoIGlzIGxvYWRlZCB3aXRoIGRhdGEgZnJvbSB0aGUgYXJyYXksIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLlxuLy8gT3RoZXJ3aXNlLCAqdyogc3BlY2lmaWVzIHRoZSB3aWR0aCAobnVtYmVyIG9mIHJvdyBlbnRyaWVzKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKmQqIHNwZWNpZmllcyB0aGUgZGVwdGggKG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpudW0qIGluZGljYXRlcyB0aGUgbnVtYmVyIG9mIGVsZW1lbnRzIGFkZC4gVGhpcyBzaG91bGQgb25seSBiZVxuLy8gcHJvdmlkZWQgaWYgKncqIGlzIGFuIGFycmF5LCBpbiB3aGljaCBjYXNlICpudW0qIGlzIHJlcXVpcmVkLlxuZnVuY3Rpb24gQ291bnRNaW4odywgZCwgbnVtKSB7XG4gIHcgPSB3IHx8IERFRkFVTFRfQklOUztcbiAgZCA9IGQgfHwgREVGQVVMVF9IQVNIO1xuXG4gIHZhciBhLCB0LCBpPS0xLCBuO1xuICBpZiAodHlwZW9mIHcgIT09IFwibnVtYmVyXCIpIHsgYSA9IHc7IHcgPSBhLmxlbmd0aCAvIGQ7IH1cbiAgdGhpcy5fdyA9IHc7XG4gIHRoaXMuX2QgPSBkO1xuICB0aGlzLl9udW0gPSBudW0gfHwgMDtcbiAgbiA9IHcgKiBkO1xuICB0ID0gdGhpcy5fdGFibGUgPSBhcnJheXMuaW50cyhuKTtcbiAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSB0W2ldID0gYVtpXTtcblxuICBoYXNoLmluaXQuY2FsbCh0aGlzKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggYmFzZWQgb24gcHJvdmlkZWQgcGVyZm9ybWFuY2UgcGFyYW1ldGVycy5cbi8vIEFyZ3VtZW50ICpuKiBpcyB0aGUgZXhwZWN0ZWQgY291bnQgb2YgYWxsIGVsZW1lbnRzXG4vLyBBcmd1bWVudCAqZSogaXMgdGhlIGFjY2VwdGFibGUgYWJzb2x1dGUgZXJyb3IuXG4vLyBBcmd1bWVudCAqcCogaXMgdGhlIHByb2JhYmlsaXR5IG9mIG5vdCBhY2hpZXZpbmcgdGhlIGVycm9yIGJvdW5kLlxuLy8gaHR0cDovL2RpbWFjcy5ydXRnZXJzLmVkdS9+Z3JhaGFtL3B1YnMvcGFwZXJzL2NtZW5jeWMucGRmXG5Db3VudE1pbi5jcmVhdGUgPSBmdW5jdGlvbihuLCBlLCBwKSB7XG4gIGUgPSBuID8gKGUgPyBlL24gOiAxL24pIDogMC4wMDE7XG4gIHAgPSBwIHx8IDAuMDAxO1xuICB2YXIgdyA9IE1hdGguY2VpbChNYXRoLkUgLyBlKSxcbiAgICAgIGQgPSBNYXRoLmNlaWwoLU1hdGgubG9nKHApKTtcbiAgcmV0dXJuIG5ldyB0aGlzKHcsIGQpO1xufTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQ291bnRNaW4uaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgdGhpcyhvYmouY291bnRzLCBvYmouZGVwdGgsIG9iai5udW0pO1xufTtcblxudmFyIHByb3RvID0gQ291bnRNaW4ucHJvdG90eXBlO1xuXG5wcm90by5sb2NhdGlvbnMgPSBoYXNoLmxvY2F0aW9ucztcblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIHNrZXRjaC5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgdCA9IHRoaXMuX3RhYmxlLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBkID0gdGhpcy5fZCwgaSwgcjtcbiAgZm9yIChpPTAsIHI9MDsgaTxkOyArK2ksIHIrPXcpIHtcbiAgICB0W3IgKyBsW2ldXSArPSAxO1xuICB9XG4gIHRoaXMuX251bSArPSAxO1xufTtcblxuLy8gUXVlcnkgZm9yIGFwcHJveGltYXRlIGNvdW50LlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBtaW4gPSArSW5maW5pdHksXG4gICAgICBsID0gdGhpcy5sb2NhdGlvbnModiArICcnKSxcbiAgICAgIHQgPSB0aGlzLl90YWJsZSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsIGksIHIsIGM7XG4gIGZvciAoaT0wLCByPTA7IGk8ZDsgKytpLCByKz13KSB7XG4gICAgYyA9IHRbciArIGxbaV1dO1xuICAgIGlmIChjIDwgbWluKSBtaW4gPSBjO1xuICB9XG4gIHJldHVybiBtaW47XG59O1xuXG4vLyBBcHByb3hpbWF0ZSBkb3QgcHJvZHVjdCB3aXRoIGFub3RoZXIgc2tldGNoLlxuLy8gVGhlIGlucHV0IHNrZXRjaCBtdXN0IGhhdmUgdGhlIHNhbWUgZGVwdGggYW5kIHdpZHRoLlxuLy8gT3RoZXJ3aXNlLCB0aGlzIG1ldGhvZCB3aWxsIHRocm93IGFuIGVycm9yLlxucHJvdG8uZG90ID0gZnVuY3Rpb24odGhhdCkge1xuICBpZiAodGhpcy5fdyAhPT0gdGhhdC5fdykgdGhyb3cgJ1NrZXRjaCB3aWR0aHMgZG8gbm90IG1hdGNoLic7XG4gIGlmICh0aGlzLl9kICE9PSB0aGF0Ll9kKSB0aHJvdyAnU2tldGNoIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgdGEgPSB0aGlzLl90YWJsZSxcbiAgICAgIHRiID0gdGhhdC5fdGFibGUsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIG0gPSB0aGlzLl9kICogdyxcbiAgICAgIG1pbiA9ICtJbmZpbml0eSxcbiAgICAgIGRvdCA9IDAsIGkgPSAwO1xuXG4gIGRvIHtcbiAgICBkb3QgKz0gdGFbaV0gKiB0YltpXTtcbiAgICBpZiAoKytpICUgdyA9PT0gMCkge1xuICAgICAgaWYgKGRvdCA8IG1pbikgbWluID0gZG90O1xuICAgICAgZG90ID0gMDtcbiAgICB9XG4gIH0gd2hpbGUgKGkgPCBtKTtcblxuICByZXR1cm4gbWluO1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIHNrZXRjaC5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIG51bTogdGhpcy5fbnVtLFxuICAgIGRlcHRoOiB0aGlzLl9kLFxuICAgIGNvdW50czogW10uc2xpY2UuY2FsbCh0aGlzLl90YWJsZSlcbiAgfTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ291bnRNaW47XG4iLCJ2YXIgYXJyYXlzID0gcmVxdWlyZSgnLi9hcnJheXMnKTtcblxuLy8gRm93bGVyL05vbGwvVm8gaGFzaGluZy5cbmZ1bmN0aW9uIGZudl8xYSh2KSB7XG4gIHZhciBhID0gMjE2NjEzNjI2MTtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB2Lmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgIHZhciBjID0gdi5jaGFyQ29kZUF0KGkpLFxuICAgICAgICBkID0gYyAmIDB4ZmYwMDtcbiAgICBpZiAoZCkgYSA9IGZudl9tdWx0aXBseShhIF4gZCA+PiA4KTtcbiAgICBhID0gZm52X211bHRpcGx5KGEgXiBjICYgMHhmZik7XG4gIH1cbiAgcmV0dXJuIGZudl9taXgoYSk7XG59XG5cbi8vIGEgKiAxNjc3NzYxOSBtb2QgMioqMzJcbmZ1bmN0aW9uIGZudl9tdWx0aXBseShhKSB7XG4gIHJldHVybiBhICsgKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG59XG5cbi8vIE9uZSBhZGRpdGlvbmFsIGl0ZXJhdGlvbiBvZiBGTlYsIGdpdmVuIGEgaGFzaC5cbmZ1bmN0aW9uIGZudl8xYV9iKGEpIHtcbiAgcmV0dXJuIGZudl9taXgoZm52X211bHRpcGx5KGEpKTtcbn1cblxuLy8gU2VlIGh0dHBzOi8vd2ViLmFyY2hpdmUub3JnL3dlYi8yMDEzMTAxOTAxMzIyNS9odHRwOi8vaG9tZS5jb21jYXN0Lm5ldC9+YnJldG0vaGFzaC82Lmh0bWxcbmZ1bmN0aW9uIGZudl9taXgoYSkge1xuICBhICs9IGEgPDwgMTM7XG4gIGEgXj0gYSA+Pj4gNztcbiAgYSArPSBhIDw8IDM7XG4gIGEgXj0gYSA+Pj4gMTc7XG4gIGEgKz0gYSA8PCA1O1xuICByZXR1cm4gYSAmIDB4ZmZmZmZmZmY7XG59XG5cbi8vIG1peC1pbiBtZXRob2QgZm9yIG11bHRpLWhhc2ggaW5pdGlhbGl6YXRpb25cbm1vZHVsZS5leHBvcnRzLmluaXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fbG9jYXRpb25zID0gYXJyYXlzLmludHModGhpcy5fZCk7XG59O1xuXG4vLyBtaXgtaW4gbWV0aG9kIGZvciBtdWx0aS1oYXNoIGNhbGN1bGF0aW9uXG4vLyBTZWUgaHR0cDovL3dpbGx3aGltLndvcmRwcmVzcy5jb20vMjAxMS8wOS8wMy9wcm9kdWNpbmctbi1oYXNoLWZ1bmN0aW9ucy1ieS1oYXNoaW5nLW9ubHktb25jZS9cbm1vZHVsZS5leHBvcnRzLmxvY2F0aW9ucyA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGQgPSB0aGlzLl9kLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICByID0gdGhpcy5fbG9jYXRpb25zLFxuICAgICAgYSA9IGZudl8xYSh2KSxcbiAgICAgIGIgPSBmbnZfMWFfYihhKSxcbiAgICAgIGkgPSAtMSxcbiAgICAgIHggPSBhICUgdztcbiAgd2hpbGUgKCsraSA8IGQpIHtcbiAgICByW2ldID0geCA8IDAgPyAoeCArIHcpIDogeDtcbiAgICB4ID0gKHggKyBiKSAlIHc7XG4gIH1cbiAgcmV0dXJuIHI7XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5mbnZfMWEgPSBmbnZfMWE7XG5tb2R1bGUuZXhwb3J0cy5mbnZfMWFfYiA9IGZudl8xYV9iO1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gIEJsb29tOiAgICAgICAgIHJlcXVpcmUoJy4vYmxvb20nKSxcbiAgQ291bnRNaW46ICAgICAgcmVxdWlyZSgnLi9jb3VudC1taW4nKSxcbiAgQ291bnRNZWFuTWluOiAgcmVxdWlyZSgnLi9jb3VudC1tZWFuLW1pbicpLFxuICBOR3JhbTogICAgICAgICByZXF1aXJlKCcuL25ncmFtJyksXG4gIFN0cmVhbVN1bW1hcnk6IHJlcXVpcmUoJy4vc3RyZWFtLXN1bW1hcnknKSxcbiAgVERpZ2VzdDogICAgICAgcmVxdWlyZSgnLi90LWRpZ2VzdCcpXG59OyIsIi8vIENyZWF0ZSBhIG5ldyBjaGFyYWN0ZXItbGV2ZWwgbi1ncmFtIHNrZXRjaC5cbi8vICpuKiBpcyB0aGUgbnVtYmVyIG9mIGNoYXJhY3RlcnMgdG8gaW5jbHVkZSwgZGVmYXVsdHMgdG8gMi5cbi8vICpjYXNlU2Vuc2l0aXZlKiBpbmRpY2F0ZXMgY2FzZS1zZW5zaXRpdml0eSwgZGVmYXVsdHMgdG8gZmFsc2UuXG4vLyAqbWFwKiBpcyBhbiBvcHRpb25hbCBleGlzdGluZyBuZ3JhbSB0byBjb3VudCBtYXAuXG5mdW5jdGlvbiBOR3JhbShuLCBjYXNlU2Vuc2l0aXZlLCBtYXApIHtcbiAgdGhpcy5fbiA9IG4gPT0gbnVsbCA/IDIgOiBuO1xuICB0aGlzLl9jYXNlID0gISFjYXNlU2Vuc2l0aXZlO1xuICB0aGlzLl9tYXAgPSBtYXAgfHwge307XG4gIHRoaXMuX25vcm0gPSBudWxsO1xufVxuXG5OR3JhbS5pbXBvcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgcmV0dXJuIG5ldyBOR3JhbShvYmoubiwgb2JqLmNhc2UsIG9iai5jb3VudHMpO1xufTtcblxudmFyIHByb3RvID0gTkdyYW0ucHJvdG90eXBlO1xuXG4vLyBBZGQgYWxsIGNvbnNlY3V0aXZlIG4tZ3JhbXMgaW4gKnMqIHRvIHRoaXMgc2tldGNoXG5wcm90by5hZGQgPSBmdW5jdGlvbihzKSB7XG4gIGlmIChzID09IG51bGwgfHwgcyA9PT0gJycpIHJldHVybjtcbiAgdGhpcy5fbm9ybSA9IG51bGw7XG4gIGNvdW50cyhTdHJpbmcocyksIHRoaXMuX24sIHRoaXMuX2Nhc2UsIHRoaXMuX21hcCk7XG59O1xuXG4vLyBhZGQgY291bnRzIG9mIG4tZ3JhbXMgaW4gc3RyaW5nIHRvIGEgbWFwXG5mdW5jdGlvbiBjb3VudHMocywgbiwgYywgbWFwKSB7XG4gIHZhciBsZW4gPSBzLmxlbmd0aCAtIG4gKyAxLFxuICAgICAgaywgaTtcbiAgXG4gIGZvciAoaT0wOyBpPGxlbjsgKytpKSB7XG4gICAgayA9IHMuc3Vic3RyKGksIG4pO1xuICAgIGlmICghYykgayA9IGsudG9Mb3dlckNhc2UoKTtcbiAgICBtYXBba10gPSBtYXBba10gPyBtYXBba10gKyAxIDogMTtcbiAgfVxufVxuXG4vLyBUaGUgb2NjdXJyZW5jZSBjb3VudCBvZiBhIGdpdmVuIG4tZ3JhbS5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24oa2V5KSB7XG4gIHJldHVybiB0aGlzLl9tYXBbdGhpcy5fY2FzZSA/IGtleSA6IGtleS50b0xvd2VyQ2FzZSgpXSB8fCAwO1xufTtcblxuLy8gUmV0dXJuIHRoZSBudW1iZXIgb2YgdW5pcXVlIG4tZ3JhbXMgb2JzZXJ2ZWQuXG5wcm90by5zaXplID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLl9tYXApLmxlbmd0aDtcbn07XG5cbi8vIFJldHVybiB0aGUgdmVjdG9yIG5vcm0gb2YgdGhlIGNvdW50cyBpbiB0aGlzIHNrZXRjaC5cbnByb3RvLm5vcm0gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuX25vcm0gPT0gbnVsbCkge1xuICAgIHZhciBtID0gdGhpcy5fbWFwLFxuICAgICAgICBzID0gMCwgaztcbiAgICBmb3IgKGsgaW4gbSkge1xuICAgICAgcyArPSBtW2tdICogbVtrXTtcbiAgICB9XG4gICAgdGhpcy5fbm9ybSA9IE1hdGguc3FydChzKTtcbiAgfVxuICByZXR1cm4gdGhpcy5fbm9ybTtcbn07XG5cbi8vIERvdCBwcm9kdWN0IHdpdGggYW5vdGhlciBuLWdyYW0gc2tldGNoLlxuLy8gVGhlIGlucHV0IHNrZXRjaCBzaG91bGQgaGF2ZSB0aGUgc2FtZSAqbiogcGFyYW1ldGVyLlxucHJvdG8uZG90ID0gZnVuY3Rpb24odGhhdCkge1xuICB2YXIgYSA9IHRoaXMuX21hcCxcbiAgICAgIGIgPSB0aGF0Ll9tYXAsXG4gICAgICBkb3QgPSAwLCBrO1xuXG4gIGZvciAoayBpbiBhKSB7XG4gICAgZG90ICs9IGFba10gKiAoYltrXSB8fCAwKTtcbiAgfVxuICBcbiAgcmV0dXJuIGRvdDtcbn07XG5cbi8vIENvc2luZSBzaW1pbGFyaXR5IHdpdGggYW5vdGhlciBuLWdyYW0gc2tldGNoLlxuLy8gVGhlIGlucHV0IHNrZXRjaCBzaG91bGQgaGF2ZSB0aGUgc2FtZSAqbiogcGFyYW1ldGVyLlxucHJvdG8uY29zaW5lID0gZnVuY3Rpb24odGhhdCkge1xuICB2YXIgYWEgPSB0aGlzLm5vcm0oKSxcbiAgICAgIGJiID0gdGhhdC5ub3JtKCk7XG4gIHJldHVybiAoYWEgJiYgYmIpID8gdGhpcy5kb3QodGhhdCkgLyAoYWEgKiBiYikgOiAwO1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIHNrZXRjaC5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIG46IHRoaXMuX24sXG4gICAgY2FzZTogdGhpcy5fY2FzZSxcbiAgICBjb3VudHM6IHRoaXMuX21hcFxuICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBOR3JhbTtcbiIsInZhciBERUZBVUxUX0NPVU5URVJTID0gMTAwO1xuXG4vLyBDcmVhdGUgYSBuZXcgc3RyZWFtIHN1bW1hcnkgc2tldGNoIGZvciB0cmFja2luZyBmcmVxdWVudCB2YWx1ZXMuXG4vLyBTZWU6ICdFZmZpY2llbnQgQ29tcHV0YXRpb24gb2YgRnJlcXVlbnQgYW5kIFRvcC1rIEVsZW1lbnRzIGluIERhdGEgU3RyZWFtcydcbi8vIGJ5IEEuIE1ldHdhbGx5LCBELiBBZ3Jhd2FsICYgQS4gRWwgQWJiYWRpLlxuLy8gQXJndW1lbnQgKncqIHNwZWNpZmllcyB0aGUgbWF4aW11bSBudW1iZXIgb2YgYWN0aXZlIGNvdW50ZXJzIHRvIG1haW50YWluLlxuLy8gSWYgbm90IHByb3ZpZGVkLCAqdyogZGVmYXVsdHMgdG8gdHJhY2tpbmcgYSBtYXhpbXVtIG9mIDEwMCB2YWx1ZXMuXG5mdW5jdGlvbiBTdHJlYW1TdW1tYXJ5KHcpIHtcbiAgdGhpcy5fdyA9IHcgfHwgREVGQVVMVF9DT1VOVEVSUztcbiAgdGhpcy5fdmFsdWVzID0ge307XG5cbiAgdGhpcy5fYnVja2V0cyA9IHtjb3VudDogLTF9O1xuICB0aGlzLl9idWNrZXRzLm5leHQgPSB0aGlzLl9idWNrZXRzO1xuICB0aGlzLl9idWNrZXRzLnByZXYgPSB0aGlzLl9idWNrZXRzO1xuXG4gIHRoaXMuX3NpemUgPSAwO1xufVxuXG4vLyBDcmVhdGUgYSBuZXcgU3RyZWFtU3VtbWFyeSBza2V0Y2ggZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuU3RyZWFtU3VtbWFyeS5pbXBvcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgdmFyIHNzID0gbmV3IFN0cmVhbVN1bW1hcnkob2JqLncpLFxuICAgICAgYmIgPSBzcy5fYnVja2V0cyxcbiAgICAgIGksIG4sIGMsIGIsIGosIG0sIGU7XG5cbiAgZm9yIChpPTAsIG49b2JqLmJ1Y2tldHMubGVuZ3RoOyBpPG47ICsraSkge1xuICAgIGMgPSBvYmouYnVja2V0c1tpXTtcbiAgICBiID0gaW5zZXJ0KGJiLnByZXYsIGJ1Y2tldChjWzBdKSk7XG4gICAgZm9yIChqPTEsIG09Yy5sZW5ndGg7IGo8bTsgais9Mikge1xuICAgICAgZSA9IGluc2VydChiLmxpc3QucHJldiwgZW50cnkoY1tqXSwgYikpO1xuICAgICAgZS5jb3VudCA9IGIuY291bnQ7XG4gICAgICBlLmVycm9yID0gY1tqKzFdO1xuICAgICAgc3MuX3NpemUgKz0gMTtcbiAgICB9XG4gIH1cbiAgXG4gIHJldHVybiBzcztcbn07XG5cbi8vIEdlbmVyYXRlIGEgbmV3IGZyZXF1ZW5jeSBidWNrZXQuXG5mdW5jdGlvbiBidWNrZXQoY291bnQpIHtcbiAgdmFyIGIgPSB7Y291bnQ6IGNvdW50fTtcbiAgYi5uZXh0ID0gYjtcbiAgYi5wcmV2ID0gYjtcbiAgYi5saXN0ID0ge307XG4gIGIubGlzdC5wcmV2ID0gYi5saXN0O1xuICBiLmxpc3QubmV4dCA9IGIubGlzdDtcbiAgcmV0dXJuIGI7XG59XG5cbi8vIEdlbmVyYXRlIGEgbmV3IGNvdW50ZXIgbm9kZSBmb3IgYSB2YWx1ZS5cbmZ1bmN0aW9uIGVudHJ5KHZhbHVlLCBidWNrZXQpIHtcbiAgcmV0dXJuIHtcbiAgICBidWNrZXQ6IGJ1Y2tldCxcbiAgICB2YWx1ZTogdmFsdWUsXG4gICAgY291bnQ6IDAsXG4gICAgZXJyb3I6IDBcbiAgfTtcbn1cblxuLy8gSW5zZXJ0ICpjdXJyKiBhaGVhZCBvZiBsaW5rZWQgbGlzdCBub2RlICpsaXN0Ki5cbmZ1bmN0aW9uIGluc2VydChsaXN0LCBjdXJyKSB7XG4gIHZhciBuZXh0ID0gbGlzdC5uZXh0O1xuICBjdXJyLm5leHQgPSBuZXh0O1xuICBjdXJyLnByZXYgPSBsaXN0O1xuICBsaXN0Lm5leHQgPSBjdXJyO1xuICBuZXh0LnByZXYgPSBjdXJyO1xuICByZXR1cm4gY3Vycjtcbn1cblxuLy8gRGV0YWNoICpjdXJyKiBmcm9tIGl0cyBsaW5rZWQgbGlzdC5cbmZ1bmN0aW9uIGRldGFjaChjdXJyKSB7XG4gIHZhciBuID0gY3Vyci5uZXh0LFxuICAgICAgcCA9IGN1cnIucHJldjtcbiAgcC5uZXh0ID0gbjtcbiAgbi5wcmV2ID0gcDtcbn1cblxudmFyIHByb3RvID0gU3RyZWFtU3VtbWFyeS5wcm90b3R5cGU7XG5cbi8vIEFkZCBhIHZhbHVlIHRvIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqdiogaXMgdGhlIHZhbHVlIHRvIGFkZC5cbi8vIEFyZ3VtZW50ICpjb3VudCogaXMgdGhlIG9wdGlvbmFsIG51bWJlciBvZiBvY2N1cnJlbmNlcyB0byByZWdpc3Rlci5cbi8vIElmICpjb3VudCogaXMgbm90IHByb3ZpZGVkLCBhbiBpbmNyZW1lbnQgb2YgMSBpcyBhc3N1bWVkLlxucHJvdG8uYWRkID0gZnVuY3Rpb24odiwgY291bnQpIHtcbiAgY291bnQgPSBjb3VudCB8fCAxO1xuICB2YXIgbm9kZSA9IHRoaXMuX3ZhbHVlc1t2XSwgYjtcblxuICBpZiAobm9kZSA9PSBudWxsKSB7XG4gICAgaWYgKHRoaXMuX3NpemUgPCB0aGlzLl93KSB7XG4gICAgICBiID0gaW5zZXJ0KHRoaXMuX2J1Y2tldHMsIGJ1Y2tldCgwKSk7XG4gICAgICBub2RlID0gaW5zZXJ0KGIubGlzdCwgZW50cnkodiwgYikpO1xuICAgICAgdGhpcy5fc2l6ZSArPSAxO1xuICAgIH0gZWxzZSB7XG4gICAgICBiID0gdGhpcy5fYnVja2V0cy5uZXh0O1xuICAgICAgbm9kZSA9IGIubGlzdC5uZXh0O1xuICAgICAgZGVsZXRlIHRoaXMuX3ZhbHVlc1tub2RlLnZhbHVlXTtcbiAgICAgIG5vZGUudmFsdWUgPSB2O1xuICAgICAgbm9kZS5lcnJvciA9IGIuY291bnQ7XG4gICAgfVxuICAgIHRoaXMuX3ZhbHVlc1t2XSA9IG5vZGU7ICAgIFxuICB9XG4gIHRoaXMuX2luY3JlbWVudChub2RlLCBjb3VudCk7XG59O1xuXG4vLyBJbmNyZW1lbnQgdGhlIGNvdW50IGluIHRoZSBzdHJlYW0gc3VtbWFyeSBkYXRhIHN0cnVjdHVyZS5cbnByb3RvLl9pbmNyZW1lbnQgPSBmdW5jdGlvbihub2RlLCBjb3VudCkge1xuICB2YXIgaGVhZCA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBvbGQgID0gbm9kZS5idWNrZXQsXG4gICAgICBwcmV2ID0gb2xkLFxuICAgICAgbmV4dCA9IHByZXYubmV4dDtcblxuICBkZXRhY2gobm9kZSk7XG4gIG5vZGUuY291bnQgKz0gY291bnQ7XG5cbiAgd2hpbGUgKG5leHQgIT09IGhlYWQpIHtcbiAgICBpZiAobm9kZS5jb3VudCA9PT0gbmV4dC5jb3VudCkge1xuICAgICAgaW5zZXJ0KG5leHQubGlzdCwgbm9kZSk7XG4gICAgICBicmVhaztcbiAgICB9IGVsc2UgaWYgKG5vZGUuY291bnQgPiBuZXh0LmNvdW50KSB7XG4gICAgICBwcmV2ID0gbmV4dDtcbiAgICAgIG5leHQgPSBwcmV2Lm5leHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5leHQgPSBoZWFkO1xuICAgIH1cbiAgfVxuXG4gIGlmIChuZXh0ID09PSBoZWFkKSB7XG4gICAgbmV4dCA9IGJ1Y2tldChub2RlLmNvdW50KTtcbiAgICBpbnNlcnQobmV4dC5saXN0LCBub2RlKTsgLy8gYWRkIHZhbHVlIG5vZGUgdG8gYnVja2V0XG4gICAgaW5zZXJ0KHByZXYsIG5leHQpOyAgLy8gYWRkIGJ1Y2tldCB0byBidWNrZXQgbGlzdFxuICB9XG4gIG5vZGUuYnVja2V0ID0gbmV4dDtcblxuICAvLyBjbGVhbiB1cCBpZiBvbGQgYnVja2V0IGlzIGVtcHR5XG4gIGlmIChvbGQubGlzdC5uZXh0ID09PSBvbGQubGlzdCkge1xuICAgIGRldGFjaChvbGQpO1xuICB9XG59O1xuXG4vLyBRdWVyeSBmb3IgYXBwcm94aW1hdGUgY291bnQgZm9yIHZhbHVlICp2Ki5cbi8vIFJldHVybnMgemVybyBpZiAqdiogaXMgbm90IGluIHRoZSBza2V0Y2guXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIG5vZGUgPSB0aGlzLl92YWx1ZXNbdl07XG4gIHJldHVybiBub2RlID8gbm9kZS5jb3VudCA6IDA7XG59O1xuXG4vLyBRdWVyeSBmb3IgZXN0aW1hdGlvbiBlcnJvciBmb3IgdmFsdWUgKnYqLlxuLy8gUmV0dXJucyAtMSBpZiAqdiogaXMgbm90IGluIHRoZSBza2V0Y2guXG5wcm90by5lcnJvciA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIG5vZGUgPSB0aGlzLl92YWx1ZXNbdl07XG4gIHJldHVybiBub2RlID8gbm9kZS5lcnJvciA6IC0xO1xufTtcblxuLy8gUmV0dXJucyB0aGUgKGFwcHJveGltYXRlKSB0b3AtayBtb3N0IGZyZXF1ZW50IHZhbHVlcyxcbi8vIHJldHVybmVkIGluIG9yZGVyIG9mIGRlY3JlYXNpbmcgZnJlcXVlbmN5LlxuLy8gQWxsIG1vbml0b3JlZCB2YWx1ZXMgYXJlIHJldHVybmVkIGlmICprKiBpcyBub3QgcHJvdmlkZWRcbi8vIG9yIGlzIGxhcmdlciB0aGFuIHRoZSBza2V0Y2ggc2l6ZS5cbnByb3RvLnZhbHVlcyA9IGZ1bmN0aW9uKGspIHtcbiAgcmV0dXJuIHRoaXMuY29sbGVjdChrLCBmdW5jdGlvbih4KSB7IHJldHVybiB4LnZhbHVlOyB9KTtcbn07XG5cbi8vIFJldHVybnMgY291bnRzIGZvciB0aGUgKGFwcHJveGltYXRlKSB0b3AtayBmcmVxdWVudCB2YWx1ZXMsXG4vLyByZXR1cm5lZCBpbiBvcmRlciBvZiBkZWNyZWFzaW5nIGZyZXF1ZW5jeS5cbi8vIEFsbCBtb25pdG9yZWQgY291bnRzIGFyZSByZXR1cm5lZCBpZiAqayogaXMgbm90IHByb3ZpZGVkXG4vLyBvciBpcyBsYXJnZXIgdGhhbiB0aGUgc2tldGNoIHNpemUuXG5wcm90by5jb3VudHMgPSBmdW5jdGlvbihrKSB7XG4gIHJldHVybiB0aGlzLmNvbGxlY3QoaywgZnVuY3Rpb24oeCkgeyByZXR1cm4geC5jb3VudDsgfSk7XG59O1xuXG4vLyBSZXR1cm5zIGVzdGltYXRpb24gZXJyb3IgdmFsdWVzIGZvciB0aGUgKGFwcHJveGltYXRlKSB0b3Ata1xuLy8gZnJlcXVlbnQgdmFsdWVzLCByZXR1cm5lZCBpbiBvcmRlciBvZiBkZWNyZWFzaW5nIGZyZXF1ZW5jeS5cbi8vIEFsbCBtb25pdG9yZWQgY291bnRzIGFyZSByZXR1cm5lZCBpZiAqayogaXMgbm90IHByb3ZpZGVkXG4vLyBvciBpcyBsYXJnZXIgdGhhbiB0aGUgc2tldGNoIHNpemUuXG5wcm90by5lcnJvcnMgPSBmdW5jdGlvbihrKSB7XG4gIHJldHVybiB0aGlzLmNvbGxlY3QoaywgZnVuY3Rpb24oeCkgeyByZXR1cm4geC5lcnJvcjsgfSk7XG59O1xuXG4vLyBDb2xsZWN0cyB2YWx1ZXMgZm9yIGVhY2ggZW50cnkgaW4gdGhlIHNrZXRjaCwgaW4gb3JkZXIgb2Zcbi8vIGRlY3JlYXNpbmcgKGFwcHJveGltYXRlKSBmcmVxdWVuY3kuXG4vLyBBcmd1bWVudCAqayogaXMgdGhlIG51bWJlciBvZiB2YWx1ZXMgdG8gY29sbGVjdC4gSWYgdGhlICprKiBpcyBub3Rcbi8vIHByb3ZpZGVkIG9yIGdyZWF0ZXIgdGhhbiB0aGUgc2tldGNoIHNpemUsIGFsbCB2YWx1ZXMgYXJlIHZpc2l0ZWQuXG4vLyBBcmd1bWVudCAqZiogaXMgYW4gYWNjZXNzb3IgZnVuY3Rpb24gZm9yIGNvbGxlY3RpbmcgYSB2YWx1ZS5cbnByb3RvLmNvbGxlY3QgPSBmdW5jdGlvbihrLCBmKSB7XG4gIGlmIChrID09PSAwKSByZXR1cm4gW107XG4gIGlmIChrID09IG51bGwgfHwgayA8IDApIGsgPSB0aGlzLl9zaXplO1xuXG4gIHZhciBkYXRhID0gQXJyYXkoayksXG4gICAgICBoZWFkID0gdGhpcy5fYnVja2V0cyxcbiAgICAgIG5vZGUsIGxpc3QsIGVudHJ5LCBpPTA7XG5cbiAgZm9yIChub2RlID0gaGVhZC5wcmV2OyBub2RlICE9PSBoZWFkOyBub2RlID0gbm9kZS5wcmV2KSB7XG4gICAgbGlzdCA9IG5vZGUubGlzdDtcbiAgICBmb3IgKGVudHJ5ID0gbGlzdC5wcmV2OyBlbnRyeSAhPT0gbGlzdDsgZW50cnkgPSBlbnRyeS5wcmV2KSB7XG4gICAgICBkYXRhW2krK10gPSBmKGVudHJ5KTtcbiAgICAgIGlmIChpID09PSBrKSByZXR1cm4gZGF0YTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZGF0YTtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBza2V0Y2guXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGhlYWQgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgb3V0ID0gW10sIGIsIG4sIGM7XG5cbiAgZm9yIChiID0gaGVhZC5uZXh0OyBiICE9PSBoZWFkOyBiID0gYi5uZXh0KSB7XG4gICAgZm9yIChjID0gW2IuY291bnRdLCBuID0gYi5saXN0Lm5leHQ7IG4gIT09IGIubGlzdDsgbiA9IG4ubmV4dCkge1xuICAgICAgYy5wdXNoKG4udmFsdWUsIG4uZXJyb3IpO1xuICAgIH1cbiAgICBvdXQucHVzaChjKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdzogdGhpcy5fdyxcbiAgICBidWNrZXRzOiBvdXRcbiAgfTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3RyZWFtU3VtbWFyeTtcbiIsIi8vIFQtRGlnZXN0cyBhcmUgYSBza2V0Y2ggZm9yIHF1YW50aWxlIGFuZCBjZGYgZXN0aW1hdGlvbi5cbi8vIFNpbWlsYXIgaW4gc3Bpcml0IHRvIGEgMUQgay1tZWFucywgdGhlIHQtZGlnZXN0IGZpdHMgYSBib3VuZGVkIHNldCBvZlxuLy8gY2VudHJvaWRzIHRvIHN0cmVhbWluZyBpbnB1dCB0byBsZWFybiBhIHZhcmlhYmxlLXdpZHRoIGhpc3RvZ3JhbS5cbi8vIFNlZTogJ0NvbXB1dGluZyBFeHRyZW1lbHkgQWNjdXJhdGUgUXVhbnRpbGVzIHVzaW5nIHQtRGlnZXN0cydcbi8vIGJ5IFQuIER1bm5pbmcgJiBPLiBFcnRsLlxuLy8gQmFzZWQgb24gdGhlIFRlZCBEdW5uaW5nJ3MgbWVyZ2luZyBkaWdlc3QgaW1wbGVtZW50YXRpb24gYXQ6XG4vLyBodHRwczovL2dpdGh1Yi5jb20vdGR1bm5pbmcvdC1kaWdlc3Rcbi8vIE9uZSBtYWpvciBkZXBhcnR1cmUgZnJvbSB0aGUgcmVmZXJlbmNlIGltcGxlbWVudGF0aW9uIGlzIHRoZSB1c2Ugb2Zcbi8vIGEgYmluYXJ5IHNlYXJjaCB0byBzcGVlZCB1cCBxdWFudGlsZSBhbmQgY2RmIHF1ZXJpZXMuXG5cbnZhciBhcnJheXMgPSByZXF1aXJlKCcuL2FycmF5cycpO1xuXG52YXIgRVBTSUxPTiA9IDFlLTMwMCxcbiAgICBERUZBVUxUX0NFTlRST0lEUyA9IDEwMDtcblxuLy8gQ3JlYXRlIGEgbmV3IHQtZGlnZXN0IHNrZXRjaCBmb3IgcXVhbnRpbGUgYW5kIGhpc3RvZ3JhbSBlc3RpbWF0aW9uLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBhcHByb3hpbWF0ZSBudW1iZXIgb2YgY2VudHJvaWRzLCBkZWZhdWx0cyB0byAxMDAuXG5mdW5jdGlvbiBURGlnZXN0KG4pIHtcbiAgdGhpcy5fbmMgPSBuIHx8IERFRkFVTFRfQ0VOVFJPSURTO1xuXG4gIC8vIFdoeSB0aGlzIHNpemU/IFNlZSBodHRwczovL2dpdGh1Yi5jb20vdmVnYS9kYXRhbGliLXNrZXRjaC9pc3N1ZXMvM1xuICB2YXIgc2l6ZSA9IDIgKiBNYXRoLmNlaWwodGhpcy5fbmMpO1xuXG4gIHRoaXMuX3RvdGFsU3VtID0gMDtcbiAgdGhpcy5fbGFzdCA9IDA7XG4gIHRoaXMuX3dlaWdodCA9IGFycmF5cy5mbG9hdHMoc2l6ZSk7XG4gIHRoaXMuX21lYW4gPSBhcnJheXMuZmxvYXRzKHNpemUpO1xuICB0aGlzLl9taW4gPSBOdW1iZXIuTUFYX1ZBTFVFO1xuICB0aGlzLl9tYXggPSAtTnVtYmVyLk1BWF9WQUxVRTtcblxuICAvLyBkb3VibGUgYnVmZmVyIHRvIHNpbXBsaWZ5IG1lcmdlIG9wZXJhdGlvbnNcbiAgLy8gX21lcmdlV2VpZ2h0IGFsc28gdXNlZCBmb3IgdHJhbnNpZW50IHN0b3JhZ2Ugb2YgY3VtdWxhdGl2ZSB3ZWlnaHRzXG4gIHRoaXMuX21lcmdlV2VpZ2h0ID0gYXJyYXlzLmZsb2F0cyhzaXplKTtcbiAgdGhpcy5fbWVyZ2VNZWFuID0gYXJyYXlzLmZsb2F0cyhzaXplKTtcblxuICAvLyB0ZW1wb3JhcnkgYnVmZmVycyBmb3IgcmVjZW50bHkgYWRkZWQgdmFsdWVzXG4gIHZhciB0ZW1wc2l6ZSA9IG51bVRlbXAodGhpcy5fbmMpO1xuICB0aGlzLl91bm1lcmdlZFN1bSA9IDA7XG4gIHRoaXMuX3RlbXBMYXN0ID0gMDtcbiAgdGhpcy5fdGVtcFdlaWdodCA9IGFycmF5cy5mbG9hdHModGVtcHNpemUpO1xuICB0aGlzLl90ZW1wTWVhbiA9IGFycmF5cy5mbG9hdHModGVtcHNpemUpO1xuICB0aGlzLl9vcmRlciA9IFtdOyAvLyBmb3Igc29ydGluZ1xufVxuXG4vLyBHaXZlbiB0aGUgbnVtYmVyIG9mIGNlbnRyb2lkcywgZGV0ZXJtaW5lIHRlbXAgYnVmZmVyIHNpemVcbi8vIFBlcmZvcm0gYmluYXJ5IHNlYXJjaCB0byBmaW5kIHZhbHVlIGsgc3VjaCB0aGF0IE4gPSBrIGxvZzIga1xuLy8gVGhpcyBzaG91bGQgZ2l2ZSB1cyBnb29kIGFtb3J0aXplZCBhc3ltcHRvdGljIGNvbXBsZXhpdHlcbmZ1bmN0aW9uIG51bVRlbXAoTikge1xuICB2YXIgbG8gPSAxLCBoaSA9IE4sIG1pZDtcbiAgd2hpbGUgKGxvIDwgaGkpIHtcbiAgICBtaWQgPSBsbyArIGhpID4+PiAxO1xuICAgIGlmIChOID4gbWlkICogTWF0aC5sb2cobWlkKSAvIE1hdGguTE4yKSB7IGxvID0gbWlkICsgMTsgfVxuICAgIGVsc2UgeyBoaSA9IG1pZDsgfVxuICB9XG4gIHJldHVybiBsbztcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IHQtZGlnZXN0IHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5URGlnZXN0LmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICB2YXIgdGQgPSBuZXcgVERpZ2VzdChvYmouY2VudHJvaWRzKTtcbiAgdmFyIHN1bSA9IDA7XG4gIHRkLl9taW4gPSBvYmoubWluO1xuICB0ZC5fbWF4ID0gb2JqLm1heDtcbiAgdGQuX2xhc3QgPSBvYmoubWVhbi5sZW5ndGggLSAxO1xuICBmb3IgKHZhciBpPTAsIG49b2JqLm1lYW4ubGVuZ3RoOyBpPG47ICsraSkge1xuICAgIHRkLl9tZWFuW2ldID0gb2JqLm1lYW5baV07XG4gICAgc3VtICs9ICh0ZC5fd2VpZ2h0W2ldID0gb2JqLndlaWdodFtpXSk7XG4gIH1cbiAgdGQuX3RvdGFsU3VtID0gc3VtO1xuICByZXR1cm4gdGQ7XG59O1xuXG52YXIgcHJvdG8gPSBURGlnZXN0LnByb3RvdHlwZTtcblxuLy8gLS0gQ29uc3RydWN0aW9uIE1ldGhvZHMgLS0tLS1cblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIHQtZGlnZXN0LlxuLy8gQXJndW1lbnQgKnYqIGlzIHRoZSB2YWx1ZSB0byBhZGQuXG4vLyBBcmd1bWVudCAqY291bnQqIGlzIHRoZSBpbnRlZ2VyIG51bWJlciBvZiBvY2N1cnJlbmNlcyB0byBhZGQuXG4vLyBJZiBub3QgcHJvdmlkZWQsICpjb3VudCogZGVmYXVsdHMgdG8gMS5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYsIGNvdW50KSB7XG4gIGlmICh2ID09IG51bGwgfHwgdiAhPT0gdikgcmV0dXJuOyAvLyBpZ25vcmUgbnVsbCwgTmFOXG4gIGNvdW50ID0gY291bnQgPT0gbnVsbCA/IDEgOiBjb3VudDtcbiAgaWYgKGNvdW50IDw9IDApIHRocm93IG5ldyBFcnJvcignQ291bnQgbXVzdCBiZSBncmVhdGVyIHRoYW4gemVyby4nKTtcblxuICBpZiAodGhpcy5fdGVtcExhc3QgPj0gdGhpcy5fdGVtcFdlaWdodC5sZW5ndGgpIHtcbiAgICB0aGlzLl9tZXJnZVZhbHVlcygpO1xuICB9XG5cbiAgdmFyIG4gPSB0aGlzLl90ZW1wTGFzdCsrO1xuICB0aGlzLl90ZW1wV2VpZ2h0W25dID0gY291bnQ7XG4gIHRoaXMuX3RlbXBNZWFuW25dID0gdjtcbiAgdGhpcy5fdW5tZXJnZWRTdW0gKz0gY291bnQ7XG59O1xuXG5wcm90by5fbWVyZ2VWYWx1ZXMgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuX3VubWVyZ2VkU3VtID09PSAwKSByZXR1cm47XG5cbiAgdmFyIHR3ID0gdGhpcy5fdGVtcFdlaWdodCxcbiAgICAgIHR1ID0gdGhpcy5fdGVtcE1lYW4sXG4gICAgICB0biA9IHRoaXMuX3RlbXBMYXN0LFxuICAgICAgdyA9IHRoaXMuX3dlaWdodCxcbiAgICAgIHUgPSB0aGlzLl9tZWFuLFxuICAgICAgbiA9IDAsXG4gICAgICBvcmRlciA9IHRoaXMuX29yZGVyLFxuICAgICAgc3VtID0gMCwgaWksIGksIGosIGsxO1xuXG4gIC8vIGdldCBzb3J0IG9yZGVyIGZvciBhZGRlZCB2YWx1ZXMgaW4gdGVtcCBidWZmZXJzXG4gIG9yZGVyLmxlbmd0aCA9IHRuO1xuICBmb3IgKGk9MDsgaTx0bjsgKytpKSBvcmRlcltpXSA9IGk7XG4gIG9yZGVyLnNvcnQoZnVuY3Rpb24oYSxiKSB7IHJldHVybiB0dVthXSAtIHR1W2JdOyB9KTtcblxuICBpZiAodGhpcy5fdG90YWxTdW0gPiAwKSBuID0gdGhpcy5fbGFzdCArIDE7XG4gIHRoaXMuX2xhc3QgPSAwO1xuICB0aGlzLl90b3RhbFN1bSArPSB0aGlzLl91bm1lcmdlZFN1bTtcbiAgdGhpcy5fdW5tZXJnZWRTdW0gPSAwO1xuXG4gIC8vIG1lcmdlIGV4aXN0aW5nIGNlbnRyb2lkcyB3aXRoIGFkZGVkIHZhbHVlcyBpbiB0ZW1wIGJ1ZmZlcnNcbiAgZm9yIChpPWo9azE9MDsgaSA8IHRuICYmIGogPCBuOykge1xuICAgIGlpID0gb3JkZXJbaV07XG4gICAgaWYgKHR1W2lpXSA8PSB1W2pdKSB7XG4gICAgICBzdW0gKz0gdHdbaWldO1xuICAgICAgazEgPSB0aGlzLl9tZXJnZUNlbnRyb2lkKHN1bSwgazEsIHR3W2lpXSwgdHVbaWldKTtcbiAgICAgIGkrKztcbiAgICB9IGVsc2Uge1xuICAgICAgc3VtICs9IHdbal07XG4gICAgICBrMSA9IHRoaXMuX21lcmdlQ2VudHJvaWQoc3VtLCBrMSwgd1tqXSwgdVtqXSk7XG4gICAgICBqKys7XG4gICAgfVxuICB9XG4gIC8vIG9ubHkgdGVtcCBidWZmZXIgdmFsdWVzIHJlbWFpblxuICBmb3IgKDsgaSA8IHRuOyArK2kpIHtcbiAgICBpaSA9IG9yZGVyW2ldO1xuICAgIHN1bSArPSB0d1tpaV07XG4gICAgazEgPSB0aGlzLl9tZXJnZUNlbnRyb2lkKHN1bSwgazEsIHR3W2lpXSwgdHVbaWldKTtcbiAgfVxuICAvLyBvbmx5IGV4aXN0aW5nIGNlbnRyb2lkcyByZW1haW5cbiAgZm9yICg7IGogPCBuOyArK2opIHtcbiAgICBzdW0gKz0gd1tqXTtcbiAgICBrMSA9IHRoaXMuX21lcmdlQ2VudHJvaWQoc3VtLCBrMSwgd1tqXSwgdVtqXSk7XG4gIH1cbiAgdGhpcy5fdGVtcExhc3QgPSAwO1xuXG4gIC8vIHN3YXAgcG9pbnRlcnMgZm9yIHdvcmtpbmcgc3BhY2UgYW5kIG1lcmdlIHNwYWNlXG4gIHRoaXMuX3dlaWdodCA9IHRoaXMuX21lcmdlV2VpZ2h0O1xuICB0aGlzLl9tZXJnZVdlaWdodCA9IHc7XG4gIHRoaXMuX21lYW4gPSB0aGlzLl9tZXJnZU1lYW47XG4gIHRoaXMuX21lcmdlTWVhbiA9IHU7XG5cbiAgdVswXSA9IHRoaXMuX3dlaWdodFswXTtcbiAgZm9yIChpPTEsIG49dGhpcy5fbGFzdCwgd1swXT0wOyBpPD1uOyArK2kpIHtcbiAgICB3W2ldID0gMDsgLy8gemVybyBvdXQgbWVyZ2Ugd2VpZ2h0c1xuICAgIHVbaV0gPSB1W2ktMV0gKyB0aGlzLl93ZWlnaHRbaV07IC8vIHN0YXNoIGN1bXVsYXRpdmUgZGlzdFxuICB9XG4gIHRoaXMuX21pbiA9IE1hdGgubWluKHRoaXMuX21pbiwgdGhpcy5fbWVhblswXSk7XG4gIHRoaXMuX21heCA9IE1hdGgubWF4KHRoaXMuX21heCwgdGhpcy5fbWVhbltuXSk7XG59O1xuXG5wcm90by5fbWVyZ2VDZW50cm9pZCA9IGZ1bmN0aW9uKHN1bSwgazEsIHd0LCB1dCkge1xuICB2YXIgdyA9IHRoaXMuX21lcmdlV2VpZ2h0LFxuICAgICAgdSA9IHRoaXMuX21lcmdlTWVhbixcbiAgICAgIG4gPSB0aGlzLl9sYXN0LFxuICAgICAgazIgPSBpbnRlZ3JhdGUodGhpcy5fbmMsIHN1bSAvIHRoaXMuX3RvdGFsU3VtKTtcblxuICBpZiAoazIgLSBrMSA8PSAxIHx8IHdbbl0gPT09IDApIHtcbiAgICAvLyBtZXJnZSBpbnRvIGV4aXN0aW5nIGNlbnRyb2lkIGlmIGNlbnRyb2lkIGluZGV4IGRpZmZlcmVuY2UgKGsyLWsxKVxuICAgIC8vIGlzIHdpdGhpbiAxIG9yIGlmIGN1cnJlbnQgY2VudHJvaWQgaXMgZW1wdHlcbiAgICB3W25dICs9IHd0O1xuICAgIHVbbl0gKz0gKHV0IC0gdVtuXSkgKiB3dCAvIHdbbl07XG4gIH0gZWxzZSB7XG4gICAgLy8gb3RoZXJ3aXNlIGNyZWF0ZSBhIG5ldyBjZW50cm9pZFxuICAgIHRoaXMuX2xhc3QgPSArK247XG4gICAgdVtuXSA9IHV0O1xuICAgIHdbbl0gPSB3dDtcbiAgICBrMSA9IGludGVncmF0ZSh0aGlzLl9uYywgKHN1bSAtIHd0KSAvIHRoaXMuX3RvdGFsU3VtKTtcbiAgfVxuXG4gIHJldHVybiBrMTtcbn07XG5cbi8vIENvbnZlcnRzIGEgcXVhbnRpbGUgaW50byBhIGNlbnRyb2lkIGluZGV4IHZhbHVlLiBUaGUgY2VudHJvaWQgaW5kZXggaXNcbi8vIG5vbWluYWxseSB0aGUgbnVtYmVyIGsgb2YgdGhlIGNlbnRyb2lkIHRoYXQgYSBxdWFudGlsZSBwb2ludCBxIHNob3VsZFxuLy8gYmVsb25nIHRvLiBEdWUgdG8gcm91bmQtb2ZmcywgaG93ZXZlciwgd2UgY2FuJ3QgYWxpZ24gdGhpbmdzIHBlcmZlY3RseVxuLy8gd2l0aG91dCBzcGxpdHRpbmcgcG9pbnRzIGFuZCBjZW50cm9pZHMuIFdlIGRvbid0IHdhbnQgdG8gZG8gdGhhdCwgc28gd2Vcbi8vIGhhdmUgdG8gYWxsb3cgZm9yIG9mZnNldHMuXG4vLyBJbiB0aGUgZW5kLCB0aGUgY3JpdGVyaW9uIGlzIHRoYXQgYW55IHF1YW50aWxlIHJhbmdlIHRoYXQgc3BhbnMgYSBjZW50cm9pZFxuLy8gaW5kZXggcmFuZ2UgbW9yZSB0aGFuIG9uZSBzaG91bGQgYmUgc3BsaXQgYWNyb3NzIG1vcmUgdGhhbiBvbmUgY2VudHJvaWQgaWZcbi8vIHBvc3NpYmxlLiBUaGlzIHdvbid0IGJlIHBvc3NpYmxlIGlmIHRoZSBxdWFudGlsZSByYW5nZSByZWZlcnMgdG8gYSBzaW5nbGVcbi8vIHBvaW50IG9yIGFuIGFscmVhZHkgZXhpc3RpbmcgY2VudHJvaWQuXG4vLyBXZSB1c2UgdGhlIGFyY3NpbiBmdW5jdGlvbiB0byBtYXAgZnJvbSB0aGUgcXVhbnRpbGUgZG9tYWluIHRvIHRoZSBjZW50cm9pZFxuLy8gaW5kZXggcmFuZ2UuIFRoaXMgcHJvZHVjZXMgYSBtYXBwaW5nIHRoYXQgaXMgc3RlZXAgbmVhciBxPTAgb3IgcT0xIHNvIGVhY2hcbi8vIGNlbnRyb2lkIHRoZXJlIHdpbGwgY29ycmVzcG9uZCB0byBsZXNzIHEgcmFuZ2UuIE5lYXIgcT0wLjUsIHRoZSBtYXBwaW5nIGlzXG4vLyBmbGF0dGVyIHNvIHRoYXQgY2VudHJvaWRzIHRoZXJlIHdpbGwgcmVwcmVzZW50IGEgbGFyZ2VyIGNodW5rIG9mIHF1YW50aWxlcy5cbmZ1bmN0aW9uIGludGVncmF0ZShuYywgcSkge1xuICAvLyBGaXJzdCwgc2NhbGUgYW5kIGJpYXMgdGhlIHF1YW50aWxlIGRvbWFpbiB0byBbLTEsIDFdXG4gIC8vIE5leHQsIGJpYXMgYW5kIHNjYWxlIHRoZSBhcmNzaW4gcmFuZ2UgdG8gWzAsIDFdXG4gIC8vIFRoaXMgZ2l2ZXMgdXMgYSBbMCwxXSBpbnRlcnBvbGFudCBmb2xsb3dpbmcgdGhlIGFyY3NpbiBzaGFwZVxuICAvLyBGaW5hbGx5LCBtdWx0aXBseSBieSBjZW50cm9pZCBjb3VudCBmb3IgY2VudHJvaWQgc2NhbGUgdmFsdWVcbiAgcmV0dXJuIG5jICogKE1hdGguYXNpbigyICogcSAtIDEpICsgTWF0aC5QSS8yKSAvIE1hdGguUEk7XG59XG5cbi8vIC0tIFF1ZXJ5IE1ldGhvZHMgLS0tLS1cblxuLy8gVGhlIG51bWJlciBvZiB2YWx1ZXMgdGhhdCBoYXZlIGJlZW4gYWRkZWQgdG8gdGhpcyBza2V0Y2guXG5wcm90by5zaXplID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLl90b3RhbFN1bSArIHRoaXMuX3VubWVyZ2VkU3VtO1xufTtcblxuLy8gUXVlcnkgZm9yIGVzdGltYXRlZCBxdWFudGlsZSAqcSouXG4vLyBBcmd1bWVudCAqcSogaXMgYSBkZXNpcmVkIHF1YW50aWxlIGluIHRoZSByYW5nZSAoMCwxKVxuLy8gRm9yIGV4YW1wbGUsIHEgPSAwLjUgcXVlcmllcyBmb3IgdGhlIG1lZGlhbi5cbnByb3RvLnF1YW50aWxlID0gZnVuY3Rpb24ocSkge1xuICB0aGlzLl9tZXJnZVZhbHVlcygpO1xuXG4gIHZhciB0b3RhbCA9IHRoaXMuX3RvdGFsU3VtLFxuICAgICAgbiA9IHRoaXMuX2xhc3QsXG4gICAgICB1ID0gdGhpcy5fbWVhbixcbiAgICAgIHcgPSB0aGlzLl93ZWlnaHQsXG4gICAgICBjID0gdGhpcy5fbWVyZ2VNZWFuLFxuICAgICAgaSwgbCwgciwgbWluLCBtYXg7XG5cbiAgbCA9IG1pbiA9IHRoaXMuX21pbjtcbiAgciA9IG1heCA9IHRoaXMuX21heDtcbiAgaWYgKHRvdGFsID09PSAwKSByZXR1cm4gTmFOO1xuICBpZiAocSA8PSAwKSByZXR1cm4gbWluO1xuICBpZiAocSA+PSAxKSByZXR1cm4gbWF4O1xuICBpZiAobiA9PT0gMCkgcmV0dXJuIHVbMF07XG5cbiAgLy8gY2FsY3VsYXRlIGJvdW5kYXJpZXMsIHBpY2sgY2VudHJvaWQgdmlhIGJpbmFyeSBzZWFyY2hcbiAgcSA9IHEgKiB0b3RhbDtcbiAgaSA9IGJpc2VjdChjLCBxLCAwLCBuKzEpO1xuICBpZiAoaSA+IDApIGwgPSBib3VuZGFyeShpLTEsIGksIHUsIHcpO1xuICBpZiAoaSA8IG4pIHIgPSBib3VuZGFyeShpLCBpKzEsIHUsIHcpO1xuICByZXR1cm4gbCArIChyLWwpICogKHEgLSAoY1tpLTFdfHwwKSkgLyB3W2ldO1xufTtcblxuLy8gUXVlcnkgdGhlIGVzdGltYXRlZCBjdW11bGF0aXZlIGRpc3RyaWJ1dGlvbiBmdW5jdGlvbi5cbi8vIEluIG90aGVyIHdvcmRzLCBxdWVyeSBmb3IgdGhlIGZyYWN0aW9uIG9mIHZhbHVlcyA8PSAqdiouXG5wcm90by5jZGYgPSBmdW5jdGlvbih2KSB7XG4gIHRoaXMuX21lcmdlVmFsdWVzKCk7XG5cbiAgdmFyIHRvdGFsID0gdGhpcy5fdG90YWxTdW0sXG4gICAgICBuID0gdGhpcy5fbGFzdCxcbiAgICAgIHUgPSB0aGlzLl9tZWFuLFxuICAgICAgdyA9IHRoaXMuX3dlaWdodCxcbiAgICAgIGMgPSB0aGlzLl9tZXJnZU1lYW4sXG4gICAgICBpLCBsLCByLCBtaW4sIG1heDtcblxuICBsID0gbWluID0gdGhpcy5fbWluO1xuICByID0gbWF4ID0gdGhpcy5fbWF4O1xuICBpZiAodG90YWwgPT09IDApIHJldHVybiBOYU47XG4gIGlmICh2IDwgbWluKSByZXR1cm4gMDtcbiAgaWYgKHYgPiBtYXgpIHJldHVybiAxO1xuICBpZiAobiA9PT0gMCkgcmV0dXJuIGludGVycCh2LCBtaW4sIG1heCk7XG5cbiAgLy8gY2FsY3VsYXRlIGJvdW5kYXJpZXMsIHBpY2sgc3RhcnQgcG9pbnQgdmlhIGJpbmFyeSBzZWFyY2hcbiAgaSA9IGJpc2VjdCh1LCB2LCAwLCBuKzEpO1xuICBpZiAoaSA+IDApIGwgPSBib3VuZGFyeShpLTEsIGksIHUsIHcpO1xuICBpZiAoaSA8IG4pIHIgPSBib3VuZGFyeShpLCBpKzEsIHUsIHcpO1xuICBpZiAodiA8IGwpIHsgLy8gc2hpZnQgb25lIGludGVydmFsIGlmIHZhbHVlIGV4Y2VlZHMgYm91bmRhcnlcbiAgICByID0gbDtcbiAgICBsID0gLS1pID8gYm91bmRhcnkoaS0xLCBpLCB1LCB3KSA6IG1pbjtcbiAgfVxuICByZXR1cm4gKChjW2ktMV18fDApICsgd1tpXSAqIGludGVycCh2LCBsLCByKSkgLyB0b3RhbDtcbn07XG5cbmZ1bmN0aW9uIGJpc2VjdChhLCB4LCBsbywgaGkpIHtcbiAgd2hpbGUgKGxvIDwgaGkpIHtcbiAgICB2YXIgbWlkID0gbG8gKyBoaSA+Pj4gMTtcbiAgICBpZiAoYVttaWRdIDwgeCkgeyBsbyA9IG1pZCArIDE7IH1cbiAgICBlbHNlIHsgaGkgPSBtaWQ7IH1cbiAgfVxuICByZXR1cm4gbG87XG59XG5cbmZ1bmN0aW9uIGJvdW5kYXJ5KGksIGosIHUsIHcpIHtcbiAgcmV0dXJuIHVbaV0gKyAodVtqXSAtIHVbaV0pICogd1tpXSAvICh3W2ldICsgd1tqXSk7XG59XG5cbmZ1bmN0aW9uIGludGVycCh4LCB4MCwgeDEpIHtcbiAgdmFyIGRlbm9tID0geDEgLSB4MDtcbiAgcmV0dXJuIGRlbm9tID4gRVBTSUxPTiA/ICh4IC0geDApIC8gZGVub20gOiAwLjU7XG59XG5cbi8vIFVuaW9uIHRoaXMgdC1kaWdlc3Qgd2l0aCBhbm90aGVyLlxucHJvdG8udW5pb24gPSBmdW5jdGlvbih0ZCkge1xuICB2YXIgdSA9IFREaWdlc3QuaW1wb3J0KHRoaXMuZXhwb3J0KCkpO1xuICB0ZC5fbWVyZ2VWYWx1ZXMoKTtcbiAgZm9yICh2YXIgaT0wLCBuPXRkLl9sYXN0OyBpPG47ICsraSkge1xuICAgIHUuYWRkKHRkLl9tZWFuW2ldLCB0ZC5fd2VpZ2h0W2ldKTtcbiAgfVxuICByZXR1cm4gdTtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBza2V0Y2guXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fbWVyZ2VWYWx1ZXMoKTtcbiAgcmV0dXJuIHtcbiAgICBjZW50cm9pZHM6IHRoaXMuX25jLFxuICAgIG1pbjogICAgICAgdGhpcy5fbWluLFxuICAgIG1heDogICAgICAgdGhpcy5fbWF4LFxuICAgIG1lYW46ICAgICAgW10uc2xpY2UuY2FsbCh0aGlzLl9tZWFuLCAwLCB0aGlzLl9sYXN0KzEpLFxuICAgIHdlaWdodDogICAgW10uc2xpY2UuY2FsbCh0aGlzLl93ZWlnaHQsIDAsIHRoaXMuX2xhc3QrMSlcbiAgfTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVERpZ2VzdDtcbiJdfQ==
