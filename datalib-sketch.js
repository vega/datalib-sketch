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
  var size = Math.ceil(this._nc * Math.PI/2);
  
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXJyYXlzLmpzIiwic3JjL2Jsb29tLmpzIiwic3JjL2NvdW50LW1lYW4tbWluLmpzIiwic3JjL2NvdW50LW1pbi5qcyIsInNyYy9oYXNoLmpzIiwic3JjL2luZGV4LmpzIiwic3JjL25ncmFtLmpzIiwic3JjL3N0cmVhbS1zdW1tYXJ5LmpzIiwic3JjL3QtZGlnZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwidmFyIFRZUEVEX0FSUkFZUyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCc7XG5cbmZ1bmN0aW9uIGZsb2F0cyhuKSB7XG4gIHJldHVybiBuZXcgRmxvYXQ2NEFycmF5KG4pO1xufVxuXG5mdW5jdGlvbiBpbnRzKG4pIHtcbiAgcmV0dXJuIG5ldyBJbnQzMkFycmF5KG4pO1xufVxuXG5mdW5jdGlvbiBhcnJheShuKSB7XG4gIHZhciBhID0gQXJyYXkobik7XG4gIGZvciAodmFyIGk9MDsgaTxuOyArK2kpIGFbaV0gPSAwO1xuICByZXR1cm4gYTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGZsb2F0czogVFlQRURfQVJSQVlTID8gZmxvYXRzIDogYXJyYXksXG4gIGludHM6IFRZUEVEX0FSUkFZUyA/IGludHMgOiBhcnJheVxufTtcbiIsIi8vIEJsb29tIEZpbHRlcnMgdGVzdCB3aGV0aGVyIGFuIGVsZW1lbnQgaXMgYSBtZW1iZXIgb2YgYSBzZXQuXG4vLyBGYWxzZSBwb3NpdGl2ZSBtYXRjaGVzIGFyZSBwb3NzaWJsZSwgYnV0IGZhbHNlIG5lZ2F0aXZlcyBhcmUgbm90LlxuLy8gU2VlIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQmxvb21fZmlsdGVyXG5cbi8vIFRoaXMgY29kZSBib3Jyb3dzIGhlYXZpbHkgZnJvbSBodHRwOi8vZ2l0aHViLmNvbS9qYXNvbmRhdmllcy9ibG9vbWZpbHRlci5qc1xuXG52YXIgYXJyYXlzID0gcmVxdWlyZSgnLi9hcnJheXMnKSxcbiAgICBoYXNoID0gcmVxdWlyZSgnLi9oYXNoJyk7XG5cbnZhciBERUZBVUxUX0JJVFMgPSAxMDI0ICogMTAyNCAqIDgsIC8vIDFNQlxuICAgIERFRkFVTFRfSEFTSCA9IDU7IC8vIE9wdGltYWwgZm9yIDIlIEZQUiBvdmVyIDFNIGVsZW1lbnRzXG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIuIElmICp3KiBpcyBhbiBhcnJheS1saWtlIG9iamVjdCwgd2l0aCBhIGxlbmd0aFxuLy8gcHJvcGVydHksIHRoZW4gdGhlIGJsb29tIGZpbHRlciBpcyBsb2FkZWQgd2l0aCBkYXRhIGZyb20gdGhlIGFycmF5LCB3aGVyZVxuLy8gZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuIE90aGVyd2lzZSwgKncqIHNob3VsZCBzcGVjaWZ5IHRoZSB3aWR0aFxuLy8gb2YgdGhlIGZpbHRlciBpbiBiaXRzLiBOb3RlIHRoYXQgKncqIGlzIHJvdW5kZWQgdXAgdG8gdGhlIG5lYXJlc3QgbXVsdGlwbGVcbi8vIG9mIDMyLiAqZCogKHRoZSBmaWx0ZXIgZGVwdGgpIHNwZWNpZmllcyB0aGUgbnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zLlxuZnVuY3Rpb24gQmxvb21GaWx0ZXIodywgZCkge1xuICB3ID0gdyB8fCBERUZBVUxUX0JJVFM7XG4gIGQgPSBkIHx8IERFRkFVTFRfSEFTSDtcblxuICB2YXIgYTtcbiAgaWYgKHR5cGVvZiB3ICE9PSBcIm51bWJlclwiKSB7IGEgPSB3OyB3ID0gYS5sZW5ndGggKiAzMjsgfVxuXG4gIHZhciBuID0gTWF0aC5jZWlsKHcgLyAzMiksXG4gICAgICBpID0gLTEsIGJ1Y2tldHM7XG4gIHRoaXMuX3cgPSB3ID0gbiAqIDMyO1xuICB0aGlzLl9kID0gZDtcblxuICBidWNrZXRzID0gdGhpcy5fYnVja2V0cyA9IGFycmF5cy5pbnRzKG4pO1xuICBpZiAoYSkgd2hpbGUgKCsraSA8IG4pIGJ1Y2tldHNbaV0gPSBhW2ldO1xuICBoYXNoLmluaXQuY2FsbCh0aGlzKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IGJsb29tIGZpbHRlciBiYXNlZCBvbiBwcm92aWRlZCBwZXJmb3JtYW5jZSBwYXJhbWV0ZXJzLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBleHBlY3RlZCBzZXQgc2l6ZSAoY2FyZGluYWxpdHkpLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBkZXNpcmVkIGZhbHNlIHBvc2l0aXZlIHJhdGUuXG4vLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jsb29tX2ZpbHRlciNPcHRpbWFsX251bWJlcl9vZl9oYXNoX2Z1bmN0aW9uc1xuQmxvb21GaWx0ZXIuY3JlYXRlID0gZnVuY3Rpb24obiwgcCkge1xuICB2YXIgdyA9IC1uICogTWF0aC5sb2cocCkgLyAoTWF0aC5MTjIgKiBNYXRoLkxOMiksXG4gICAgICBkID0gKHcgLyBuKSAqIE1hdGguTE4yO1xuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKH5+dywgfn5kKTtcbn07XG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQmxvb21GaWx0ZXIuaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIob2JqLmJpdHMsIG9iai5kZXB0aCk7XG59O1xuXG52YXIgcHJvdG8gPSBCbG9vbUZpbHRlci5wcm90b3R5cGU7XG5cbnByb3RvLmxvY2F0aW9ucyA9IGhhc2gubG9jYXRpb25zO1xuXG4vLyBBZGQgYSB2YWx1ZSB0byB0aGUgZmlsdGVyLlxucHJvdG8uYWRkID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICBpID0gLTEsXG4gICAgICBkID0gdGhpcy5fZCxcbiAgICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzO1xuICB3aGlsZSAoKytpIDwgZCkgYnVja2V0c1tNYXRoLmZsb29yKGxbaV0gLyAzMildIHw9IDEgPDwgKGxbaV0gJSAzMik7XG59O1xuXG4vLyBRdWVyeSBmb3IgaW5jbHVzaW9uIGluIHRoZSBmaWx0ZXIuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBiLFxuICAgICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHM7XG4gIHdoaWxlICgrK2kgPCBkKSB7XG4gICAgYiA9IGxbaV07XG4gICAgaWYgKChidWNrZXRzW01hdGguZmxvb3IoYiAvIDMyKV0gJiAoMSA8PCAoYiAlIDMyKSkpID09PSAwKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXN0aW1hdGVkIGNhcmRpbmFsaXR5LlxucHJvdG8uc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiaXRzID0gMCwgaSwgbjtcbiAgZm9yIChpPTAsIG49YnVja2V0cy5sZW5ndGg7IGk8bjsgKytpKSBiaXRzICs9IGJpdGNvdW50KGJ1Y2tldHNbaV0pO1xuICByZXR1cm4gLXRoaXMuX3cgKiBNYXRoLmxvZygxIC0gYml0cyAvIHRoaXMuX3cpIC8gdGhpcy5fZDtcbn07XG5cbi8vIFVuaW9uIHRoaXMgYmxvb20gZmlsdGVyIHdpdGggYW5vdGhlci5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLnVuaW9uID0gZnVuY3Rpb24oYmYpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB6ID0gYXJyYXlzLmludHMobiksXG4gICAgICBpO1xuXG4gIGZvciAoaT0wOyBpPG47ICsraSkge1xuICAgIHpbaV0gPSBhW2ldIHwgYltpXTtcbiAgfVxuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKHosIHRoaXMuX2QpO1xufTtcblxuLy8gSW50ZXJuYWwgaGVscGVyIG1ldGhvZCBmb3IgYmxvb20gZmlsdGVyIGNvbXBhcmlzb24gZXN0aW1hdGVzLlxucHJvdG8uX2VzdGltYXRlID0gZnVuY3Rpb24oYmYsIGtlcm5lbCkge1xuICBpZiAoYmYuX3cgIT09IHRoaXMuX3cpIHRocm93ICdGaWx0ZXIgd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAoYmYuX2QgIT09IHRoaXMuX2QpIHRocm93ICdGaWx0ZXIgZGVwdGhzIGRvIG5vdCBtYXRjaC4nO1xuXG4gIHZhciBhID0gdGhpcy5fYnVja2V0cyxcbiAgICAgIGIgPSBiZi5fYnVja2V0cyxcbiAgICAgIG4gPSBhLmxlbmd0aCxcbiAgICAgIHgsIHksIHosIGk7XG5cbiAgZm9yIChpPXg9eT16PTA7IGk8bjsgKytpKSB7XG4gICAgeCArPSBiaXRjb3VudChhW2ldKTtcbiAgICB5ICs9IGJpdGNvdW50KGJbaV0pO1xuICAgIHogKz0gYml0Y291bnQoYVtpXSB8IGJbaV0pO1xuICB9XG4gIHggPSBNYXRoLmxvZygxIC0geCAvIHRoaXMuX3cpO1xuICB5ID0gTWF0aC5sb2coMSAtIHkgLyB0aGlzLl93KTtcbiAgeiA9IE1hdGgubG9nKDEgLSB6IC8gdGhpcy5fdyk7XG4gIHJldHVybiBrZXJuZWwoeCwgeSwgeik7XG59O1xuXG4vLyBKYWNjYXJkIGNvLWVmZmljaWVudCBvZiB0d28gYmxvb20gZmlsdGVycy5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIHNpemUgYW5kIGhhc2ggY291bnQuXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5qYWNjYXJkID0gZnVuY3Rpb24oYmYpIHtcbiAgcmV0dXJuIHRoaXMuX2VzdGltYXRlKGJmLCBmdW5jdGlvbihhLCBiLCB1bmlvbikge1xuICAgIHJldHVybiB1bmlvbiA/IChhICsgYikgLyB1bmlvbiAtIDEgOiAwO1xuICB9KTtcbn07XG5cbi8vIFNldCBjb3ZlciBvdmVyIHRoZSBzbWFsbGVyIG9mIHR3byBibG9vbSBmaWx0ZXJzLlxuLy8gVGhlIGlucHV0IGZpbHRlciBtdXN0IGhhdmUgdGhlIHNhbWUgc2l6ZSBhbmQgaGFzaCBjb3VudC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmNvdmVyID0gZnVuY3Rpb24oYmYpIHtcbiAgcmV0dXJuIHRoaXMuX2VzdGltYXRlKGJmLCBmdW5jdGlvbihhLCBiLCB1bmlvbikge1xuICAgIHZhciBkZW5vbSA9IE1hdGgubWF4KGEsIGIpO1xuICAgIHJldHVybiBkZW5vbSA/IChhICsgYiAtIHVuaW9uKSAvIGRlbm9tIDogMDtcbiAgfSk7XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgZmlsdGVyLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgZGVwdGg6IHRoaXMuX2QsXG4gICAgYml0czogW10uc2xpY2UuY2FsbCh0aGlzLl9idWNrZXRzKVxuICB9O1xufTtcblxuLy8gaHR0cDovL2dyYXBoaWNzLnN0YW5mb3JkLmVkdS9+c2VhbmRlci9iaXRoYWNrcy5odG1sI0NvdW50Qml0c1NldFBhcmFsbGVsXG5mdW5jdGlvbiBiaXRjb3VudCh2KSB7XG4gIHYgLT0gKHYgPj4gMSkgJiAweDU1NTU1NTU1O1xuICB2ID0gKHYgJiAweDMzMzMzMzMzKSArICgodiA+PiAyKSAmIDB4MzMzMzMzMzMpO1xuICByZXR1cm4gKCh2ICsgKHYgPj4gNCkgJiAweEYwRjBGMEYpICogMHgxMDEwMTAxKSA+PiAyNDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBCbG9vbUZpbHRlcjtcbiIsIi8vIENvdW50LU1lYW4tTWluIHNrZXRjaGVzIGV4dGVuZCBDb3VudC1NaW4gd2l0aCBpbXByb3ZlZCBlc3RpbWF0aW9uLlxuLy8gU2VlICdOZXcgRXN0aW1hdGlvbiBBbGdvcml0aG1zIGZvciBTdHJlYW1pbmcgRGF0YTogQ291bnQtbWluIENhbiBEbyBNb3JlJ1xuLy8gYnkgRGVuZyAmIFJhZmllaSwgaHR0cDovL3dlYmRvY3MuY3MudWFsYmVydGEuY2EvfmZhbmRlbmcvcGFwZXIvY21tLnBkZlxuXG52YXIgQ291bnRNaW4gPSByZXF1aXJlKCcuL2NvdW50LW1pbicpO1xuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWVhbi1NaW4gc2tldGNoLlxuLy8gSWYgYXJndW1lbnQgKncqIGlzIGFuIGFycmF5LWxpa2Ugb2JqZWN0LCB3aXRoIGEgbGVuZ3RoIHByb3BlcnR5LCB0aGVuIHRoZVxuLy8gc2tldGNoIGlzIGxvYWRlZCB3aXRoIGRhdGEgZnJvbSB0aGUgYXJyYXksIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLlxuLy8gT3RoZXJ3aXNlLCAqdyogc3BlY2lmaWVzIHRoZSB3aWR0aCAobnVtYmVyIG9mIHJvdyBlbnRyaWVzKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKmQqIHNwZWNpZmllcyB0aGUgZGVwdGggKG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpudW0qIGluZGljYXRlcyB0aGUgbnVtYmVyIG9mIGVsZW1lbnRzIGFkZC4gVGhpcyBzaG91bGQgb25seSBiZVxuLy8gcHJvdmlkZWQgaWYgKncqIGlzIGFuIGFycmF5LCBpbiB3aGljaCBjYXNlICpudW0qIGlzIHJlcXVpcmVkLlxuZnVuY3Rpb24gQ291bnRNZWFuTWluKHcsIGQsIG51bSkge1xuICBDb3VudE1pbi5jYWxsKHRoaXMsIHcsIGQsIG51bSk7XG4gIHRoaXMuX3EgPSBBcnJheShkKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggYmFzZWQgb24gcHJvdmlkZWQgcGVyZm9ybWFuY2UgcGFyYW1ldGVycy5cbi8vIEFyZ3VtZW50ICpuKiBpcyB0aGUgZXhwZWN0ZWQgY291bnQgb2YgYWxsIGVsZW1lbnRzXG4vLyBBcmd1bWVudCAqZSogaXMgdGhlIGFjY2VwdGFibGUgYWJzb2x1dGUgZXJyb3IuXG4vLyBBcmd1bWVudCAqcCogaXMgdGhlIHByb2JhYmlsaXR5IG9mIG5vdCBhY2hpZXZpbmcgdGhlIGVycm9yIGJvdW5kLlxuQ291bnRNZWFuTWluLmNyZWF0ZSA9IENvdW50TWluLmNyZWF0ZTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1lYW4tTWluIHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5Db3VudE1lYW5NaW4uaW1wb3J0ID0gQ291bnRNaW4uaW1wb3J0O1xuXG52YXIgcHJvdG8gPSAoQ291bnRNZWFuTWluLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoQ291bnRNaW4ucHJvdG90eXBlKSk7XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICBxID0gdGhpcy5fcSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBuID0gdGhpcy5fbnVtLFxuICAgICAgcyA9IDEgLyAody0xKSxcbiAgICAgIG1pbiA9ICtJbmZpbml0eSwgYywgaSwgcjtcblxuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIGMgPSB0W3IgKyBsW2ldXTtcbiAgICBpZiAoYyA8IG1pbikgbWluID0gYztcbiAgICBjID0gYyAtIChuLWMpICogcztcbiAgICBxW2ldID0gYztcbiAgfVxuXG4gIHJldHVybiAoYyA9IG1lZGlhbihxKSkgPCAwID8gMCA6IGMgPiBtaW4gPyBtaW4gOiBjO1xufTtcblxuLy8gQXBwcm94aW1hdGUgZG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgaWYgKHRoaXMuX3cgIT09IHRoYXQuX3cpIHRocm93ICdTa2V0Y2ggd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAodGhpcy5fZCAhPT0gdGhhdC5fZCkgdGhyb3cgJ1NrZXRjaCBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIHRhID0gdGhpcy5fdGFibGUsXG4gICAgICB0YiA9IHRoYXQuX3RhYmxlLFxuICAgICAgcSA9IHRoaXMuX3EsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIG4gPSB0aGlzLl9udW0sXG4gICAgICBtID0gdGhpcy5fZCAqIHcsXG4gICAgICB6ID0gKHcgLSAxKSAvIHcsXG4gICAgICBzID0gMSAvICh3LTEpLFxuICAgICAgZG90ID0gMCwgaSA9IDA7XG5cbiAgZG8ge1xuICAgIGRvdCArPSAodGFbaV0gLSAobi10YVtpXSkqcykgKiAodGJbaV0gLSAobi10YltpXSkqcyk7XG4gICAgaWYgKCsraSAlIHcgPT09IDApIHtcbiAgICAgIHFbaS93LTFdID0geiAqIGRvdDtcbiAgICAgIGRvdCA9IDA7XG4gICAgfVxuICB9IHdoaWxlIChpIDwgbSk7XG5cbiAgcmV0dXJuIChkb3QgPSBtZWRpYW4ocSkpIDwgMCA/IDAgOiBkb3Q7XG59O1xuXG5mdW5jdGlvbiBtZWRpYW4ocSkge1xuICBxLnNvcnQobnVtY21wKTtcbiAgdmFyIG4gPSBxLmxlbmd0aCxcbiAgICAgIGggPSB+fihuLzIpO1xuICByZXR1cm4gbiAlIDIgPyBxW2hdIDogMC41ICogKHFbaC0xXSArIHFbaF0pO1xufVxuXG5mdW5jdGlvbiBudW1jbXAoYSwgYikge1xuICByZXR1cm4gYSAtIGI7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQ291bnRNZWFuTWluO1xuIiwidmFyIGFycmF5cyA9IHJlcXVpcmUoJy4vYXJyYXlzJyksXG4gICAgaGFzaCA9IHJlcXVpcmUoJy4vaGFzaCcpO1xuXG52YXIgREVGQVVMVF9CSU5TID0gMjcxOTEsXG4gICAgREVGQVVMVF9IQVNIID0gOTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggZm9yIGFwcHJveGltYXRlIGNvdW50cyBvZiB2YWx1ZSBmcmVxdWVuY2llcy5cbi8vIFNlZTogJ0FuIEltcHJvdmVkIERhdGEgU3RyZWFtIFN1bW1hcnk6IFRoZSBDb3VudC1NaW4gU2tldGNoIGFuZCBpdHNcbi8vIEFwcGxpY2F0aW9ucycgYnkgRy4gQ29ybW9kZSAmIFMuIE11dGh1a3Jpc2huYW4uXG4vLyBJZiBhcmd1bWVudCAqdyogaXMgYW4gYXJyYXktbGlrZSBvYmplY3QsIHdpdGggYSBsZW5ndGggcHJvcGVydHksIHRoZW4gdGhlXG4vLyBza2V0Y2ggaXMgbG9hZGVkIHdpdGggZGF0YSBmcm9tIHRoZSBhcnJheSwgZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuXG4vLyBPdGhlcndpc2UsICp3KiBzcGVjaWZpZXMgdGhlIHdpZHRoIChudW1iZXIgb2Ygcm93IGVudHJpZXMpIG9mIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqZCogc3BlY2lmaWVzIHRoZSBkZXB0aCAobnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKm51bSogaW5kaWNhdGVzIHRoZSBudW1iZXIgb2YgZWxlbWVudHMgYWRkLiBUaGlzIHNob3VsZCBvbmx5IGJlXG4vLyBwcm92aWRlZCBpZiAqdyogaXMgYW4gYXJyYXksIGluIHdoaWNoIGNhc2UgKm51bSogaXMgcmVxdWlyZWQuXG5mdW5jdGlvbiBDb3VudE1pbih3LCBkLCBudW0pIHtcbiAgdyA9IHcgfHwgREVGQVVMVF9CSU5TO1xuICBkID0gZCB8fCBERUZBVUxUX0hBU0g7XG5cbiAgdmFyIGEsIHQsIGk9LTEsIG47XG4gIGlmICh0eXBlb2YgdyAhPT0gXCJudW1iZXJcIikgeyBhID0gdzsgdyA9IGEubGVuZ3RoIC8gZDsgfVxuICB0aGlzLl93ID0gdztcbiAgdGhpcy5fZCA9IGQ7XG4gIHRoaXMuX251bSA9IG51bSB8fCAwO1xuICBuID0gdyAqIGQ7XG4gIHQgPSB0aGlzLl90YWJsZSA9IGFycmF5cy5pbnRzKG4pO1xuICBpZiAoYSkgd2hpbGUgKCsraSA8IG4pIHRbaV0gPSBhW2ldO1xuXG4gIGhhc2guaW5pdC5jYWxsKHRoaXMpO1xufVxuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWluIHNrZXRjaCBiYXNlZCBvbiBwcm92aWRlZCBwZXJmb3JtYW5jZSBwYXJhbWV0ZXJzLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBleHBlY3RlZCBjb3VudCBvZiBhbGwgZWxlbWVudHNcbi8vIEFyZ3VtZW50ICplKiBpcyB0aGUgYWNjZXB0YWJsZSBhYnNvbHV0ZSBlcnJvci5cbi8vIEFyZ3VtZW50ICpwKiBpcyB0aGUgcHJvYmFiaWxpdHkgb2Ygbm90IGFjaGlldmluZyB0aGUgZXJyb3IgYm91bmQuXG4vLyBodHRwOi8vZGltYWNzLnJ1dGdlcnMuZWR1L35ncmFoYW0vcHVicy9wYXBlcnMvY21lbmN5Yy5wZGZcbkNvdW50TWluLmNyZWF0ZSA9IGZ1bmN0aW9uKG4sIGUsIHApIHtcbiAgZSA9IG4gPyAoZSA/IGUvbiA6IDEvbikgOiAwLjAwMTtcbiAgcCA9IHAgfHwgMC4wMDE7XG4gIHZhciB3ID0gTWF0aC5jZWlsKE1hdGguRSAvIGUpLFxuICAgICAgZCA9IE1hdGguY2VpbCgtTWF0aC5sb2cocCkpO1xuICByZXR1cm4gbmV3IHRoaXModywgZCk7XG59O1xuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWluIHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5Db3VudE1pbi5pbXBvcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgcmV0dXJuIG5ldyB0aGlzKG9iai5jb3VudHMsIG9iai5kZXB0aCwgb2JqLm51bSk7XG59O1xuXG52YXIgcHJvdG8gPSBDb3VudE1pbi5wcm90b3R5cGU7XG5cbnByb3RvLmxvY2F0aW9ucyA9IGhhc2gubG9jYXRpb25zO1xuXG4vLyBBZGQgYSB2YWx1ZSB0byB0aGUgc2tldGNoLlxucHJvdG8uYWRkID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLCBpLCByO1xuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIHRbciArIGxbaV1dICs9IDE7XG4gIH1cbiAgdGhpcy5fbnVtICs9IDE7XG59O1xuXG4vLyBRdWVyeSBmb3IgYXBwcm94aW1hdGUgY291bnQuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIG1pbiA9ICtJbmZpbml0eSxcbiAgICAgIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgdCA9IHRoaXMuX3RhYmxlLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBkID0gdGhpcy5fZCwgaSwgciwgYztcbiAgZm9yIChpPTAsIHI9MDsgaTxkOyArK2ksIHIrPXcpIHtcbiAgICBjID0gdFtyICsgbFtpXV07XG4gICAgaWYgKGMgPCBtaW4pIG1pbiA9IGM7XG4gIH1cbiAgcmV0dXJuIG1pbjtcbn07XG5cbi8vIEFwcHJveGltYXRlIGRvdCBwcm9kdWN0IHdpdGggYW5vdGhlciBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIG11c3QgaGF2ZSB0aGUgc2FtZSBkZXB0aCBhbmQgd2lkdGguXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gIGlmICh0aGlzLl93ICE9PSB0aGF0Ll93KSB0aHJvdyAnU2tldGNoIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKHRoaXMuX2QgIT09IHRoYXQuX2QpIHRocm93ICdTa2V0Y2ggZGVwdGhzIGRvIG5vdCBtYXRjaC4nO1xuXG4gIHZhciB0YSA9IHRoaXMuX3RhYmxlLFxuICAgICAgdGIgPSB0aGF0Ll90YWJsZSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgbSA9IHRoaXMuX2QgKiB3LFxuICAgICAgbWluID0gK0luZmluaXR5LFxuICAgICAgZG90ID0gMCwgaSA9IDA7XG5cbiAgZG8ge1xuICAgIGRvdCArPSB0YVtpXSAqIHRiW2ldO1xuICAgIGlmICgrK2kgJSB3ID09PSAwKSB7XG4gICAgICBpZiAoZG90IDwgbWluKSBtaW4gPSBkb3Q7XG4gICAgICBkb3QgPSAwO1xuICAgIH1cbiAgfSB3aGlsZSAoaSA8IG0pO1xuXG4gIHJldHVybiBtaW47XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgc2tldGNoLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgbnVtOiB0aGlzLl9udW0sXG4gICAgZGVwdGg6IHRoaXMuX2QsXG4gICAgY291bnRzOiBbXS5zbGljZS5jYWxsKHRoaXMuX3RhYmxlKVxuICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBDb3VudE1pbjtcbiIsInZhciBhcnJheXMgPSByZXF1aXJlKCcuL2FycmF5cycpO1xuXG4vLyBGb3dsZXIvTm9sbC9WbyBoYXNoaW5nLlxuZnVuY3Rpb24gZm52XzFhKHYpIHtcbiAgdmFyIGEgPSAyMTY2MTM2MjYxO1xuICBmb3IgKHZhciBpID0gMCwgbiA9IHYubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgdmFyIGMgPSB2LmNoYXJDb2RlQXQoaSksXG4gICAgICAgIGQgPSBjICYgMHhmZjAwO1xuICAgIGlmIChkKSBhID0gZm52X211bHRpcGx5KGEgXiBkID4+IDgpO1xuICAgIGEgPSBmbnZfbXVsdGlwbHkoYSBeIGMgJiAweGZmKTtcbiAgfVxuICByZXR1cm4gZm52X21peChhKTtcbn1cblxuLy8gYSAqIDE2Nzc3NjE5IG1vZCAyKiozMlxuZnVuY3Rpb24gZm52X211bHRpcGx5KGEpIHtcbiAgcmV0dXJuIGEgKyAoYSA8PCAxKSArIChhIDw8IDQpICsgKGEgPDwgNykgKyAoYSA8PCA4KSArIChhIDw8IDI0KTtcbn1cblxuLy8gT25lIGFkZGl0aW9uYWwgaXRlcmF0aW9uIG9mIEZOViwgZ2l2ZW4gYSBoYXNoLlxuZnVuY3Rpb24gZm52XzFhX2IoYSkge1xuICByZXR1cm4gZm52X21peChmbnZfbXVsdGlwbHkoYSkpO1xufVxuXG4vLyBTZWUgaHR0cHM6Ly93ZWIuYXJjaGl2ZS5vcmcvd2ViLzIwMTMxMDE5MDEzMjI1L2h0dHA6Ly9ob21lLmNvbWNhc3QubmV0L35icmV0bS9oYXNoLzYuaHRtbFxuZnVuY3Rpb24gZm52X21peChhKSB7XG4gIGEgKz0gYSA8PCAxMztcbiAgYSBePSBhID4+PiA3O1xuICBhICs9IGEgPDwgMztcbiAgYSBePSBhID4+PiAxNztcbiAgYSArPSBhIDw8IDU7XG4gIHJldHVybiBhICYgMHhmZmZmZmZmZjtcbn1cblxuLy8gbWl4LWluIG1ldGhvZCBmb3IgbXVsdGktaGFzaCBpbml0aWFsaXphdGlvblxubW9kdWxlLmV4cG9ydHMuaW5pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9sb2NhdGlvbnMgPSBhcnJheXMuaW50cyh0aGlzLl9kKTtcbn07XG5cbi8vIG1peC1pbiBtZXRob2QgZm9yIG11bHRpLWhhc2ggY2FsY3VsYXRpb25cbi8vIFNlZSBodHRwOi8vd2lsbHdoaW0ud29yZHByZXNzLmNvbS8yMDExLzA5LzAzL3Byb2R1Y2luZy1uLWhhc2gtZnVuY3Rpb25zLWJ5LWhhc2hpbmctb25seS1vbmNlL1xubW9kdWxlLmV4cG9ydHMubG9jYXRpb25zID0gZnVuY3Rpb24odikge1xuICB2YXIgZCA9IHRoaXMuX2QsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIHIgPSB0aGlzLl9sb2NhdGlvbnMsXG4gICAgICBhID0gZm52XzFhKHYpLFxuICAgICAgYiA9IGZudl8xYV9iKGEpLFxuICAgICAgaSA9IC0xLFxuICAgICAgeCA9IGEgJSB3O1xuICB3aGlsZSAoKytpIDwgZCkge1xuICAgIHJbaV0gPSB4IDwgMCA/ICh4ICsgdykgOiB4O1xuICAgIHggPSAoeCArIGIpICUgdztcbiAgfVxuICByZXR1cm4gcjtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmZudl8xYSA9IGZudl8xYTtcbm1vZHVsZS5leHBvcnRzLmZudl8xYV9iID0gZm52XzFhX2I7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgQmxvb206ICAgICAgICAgcmVxdWlyZSgnLi9ibG9vbScpLFxuICBDb3VudE1pbjogICAgICByZXF1aXJlKCcuL2NvdW50LW1pbicpLFxuICBDb3VudE1lYW5NaW46ICByZXF1aXJlKCcuL2NvdW50LW1lYW4tbWluJyksXG4gIE5HcmFtOiAgICAgICAgIHJlcXVpcmUoJy4vbmdyYW0nKSxcbiAgU3RyZWFtU3VtbWFyeTogcmVxdWlyZSgnLi9zdHJlYW0tc3VtbWFyeScpLFxuICBURGlnZXN0OiAgICAgICByZXF1aXJlKCcuL3QtZGlnZXN0Jylcbn07IiwiLy8gQ3JlYXRlIGEgbmV3IGNoYXJhY3Rlci1sZXZlbCBuLWdyYW0gc2tldGNoLlxuLy8gKm4qIGlzIHRoZSBudW1iZXIgb2YgY2hhcmFjdGVycyB0byBpbmNsdWRlLCBkZWZhdWx0cyB0byAyLlxuLy8gKmNhc2VTZW5zaXRpdmUqIGluZGljYXRlcyBjYXNlLXNlbnNpdGl2aXR5LCBkZWZhdWx0cyB0byBmYWxzZS5cbi8vICptYXAqIGlzIGFuIG9wdGlvbmFsIGV4aXN0aW5nIG5ncmFtIHRvIGNvdW50IG1hcC5cbmZ1bmN0aW9uIE5HcmFtKG4sIGNhc2VTZW5zaXRpdmUsIG1hcCkge1xuICB0aGlzLl9uID0gbiA9PSBudWxsID8gMiA6IG47XG4gIHRoaXMuX2Nhc2UgPSAhIWNhc2VTZW5zaXRpdmU7XG4gIHRoaXMuX21hcCA9IG1hcCB8fCB7fTtcbiAgdGhpcy5fbm9ybSA9IG51bGw7XG59XG5cbk5HcmFtLmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICByZXR1cm4gbmV3IE5HcmFtKG9iai5uLCBvYmouY2FzZSwgb2JqLmNvdW50cyk7XG59O1xuXG52YXIgcHJvdG8gPSBOR3JhbS5wcm90b3R5cGU7XG5cbi8vIEFkZCBhbGwgY29uc2VjdXRpdmUgbi1ncmFtcyBpbiAqcyogdG8gdGhpcyBza2V0Y2hcbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKHMgPT0gbnVsbCB8fCBzID09PSAnJykgcmV0dXJuO1xuICB0aGlzLl9ub3JtID0gbnVsbDtcbiAgY291bnRzKFN0cmluZyhzKSwgdGhpcy5fbiwgdGhpcy5fY2FzZSwgdGhpcy5fbWFwKTtcbn07XG5cbi8vIGFkZCBjb3VudHMgb2Ygbi1ncmFtcyBpbiBzdHJpbmcgdG8gYSBtYXBcbmZ1bmN0aW9uIGNvdW50cyhzLCBuLCBjLCBtYXApIHtcbiAgdmFyIGxlbiA9IHMubGVuZ3RoIC0gbiArIDEsXG4gICAgICBrLCBpO1xuICBcbiAgZm9yIChpPTA7IGk8bGVuOyArK2kpIHtcbiAgICBrID0gcy5zdWJzdHIoaSwgbik7XG4gICAgaWYgKCFjKSBrID0gay50b0xvd2VyQ2FzZSgpO1xuICAgIG1hcFtrXSA9IG1hcFtrXSA/IG1hcFtrXSArIDEgOiAxO1xuICB9XG59XG5cbi8vIFRoZSBvY2N1cnJlbmNlIGNvdW50IG9mIGEgZ2l2ZW4gbi1ncmFtLlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbihrZXkpIHtcbiAgcmV0dXJuIHRoaXMuX21hcFt0aGlzLl9jYXNlID8ga2V5IDoga2V5LnRvTG93ZXJDYXNlKCldIHx8IDA7XG59O1xuXG4vLyBSZXR1cm4gdGhlIG51bWJlciBvZiB1bmlxdWUgbi1ncmFtcyBvYnNlcnZlZC5cbnByb3RvLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuX21hcCkubGVuZ3RoO1xufTtcblxuLy8gUmV0dXJuIHRoZSB2ZWN0b3Igbm9ybSBvZiB0aGUgY291bnRzIGluIHRoaXMgc2tldGNoLlxucHJvdG8ubm9ybSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5fbm9ybSA9PSBudWxsKSB7XG4gICAgdmFyIG0gPSB0aGlzLl9tYXAsXG4gICAgICAgIHMgPSAwLCBrO1xuICAgIGZvciAoayBpbiBtKSB7XG4gICAgICBzICs9IG1ba10gKiBtW2tdO1xuICAgIH1cbiAgICB0aGlzLl9ub3JtID0gTWF0aC5zcXJ0KHMpO1xuICB9XG4gIHJldHVybiB0aGlzLl9ub3JtO1xufTtcblxuLy8gRG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIG4tZ3JhbSBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIHNob3VsZCBoYXZlIHRoZSBzYW1lICpuKiBwYXJhbWV0ZXIuXG5wcm90by5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gIHZhciBhID0gdGhpcy5fbWFwLFxuICAgICAgYiA9IHRoYXQuX21hcCxcbiAgICAgIGRvdCA9IDAsIGs7XG5cbiAgZm9yIChrIGluIGEpIHtcbiAgICBkb3QgKz0gYVtrXSAqIChiW2tdIHx8IDApO1xuICB9XG4gIFxuICByZXR1cm4gZG90O1xufTtcblxuLy8gQ29zaW5lIHNpbWlsYXJpdHkgd2l0aCBhbm90aGVyIG4tZ3JhbSBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIHNob3VsZCBoYXZlIHRoZSBzYW1lICpuKiBwYXJhbWV0ZXIuXG5wcm90by5jb3NpbmUgPSBmdW5jdGlvbih0aGF0KSB7XG4gIHZhciBhYSA9IHRoaXMubm9ybSgpLFxuICAgICAgYmIgPSB0aGF0Lm5vcm0oKTtcbiAgcmV0dXJuIChhYSAmJiBiYikgPyB0aGlzLmRvdCh0aGF0KSAvIChhYSAqIGJiKSA6IDA7XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgc2tldGNoLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgbjogdGhpcy5fbixcbiAgICBjYXNlOiB0aGlzLl9jYXNlLFxuICAgIGNvdW50czogdGhpcy5fbWFwXG4gIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE5HcmFtO1xuIiwidmFyIERFRkFVTFRfQ09VTlRFUlMgPSAxMDA7XG5cbi8vIENyZWF0ZSBhIG5ldyBzdHJlYW0gc3VtbWFyeSBza2V0Y2ggZm9yIHRyYWNraW5nIGZyZXF1ZW50IHZhbHVlcy5cbi8vIFNlZTogJ0VmZmljaWVudCBDb21wdXRhdGlvbiBvZiBGcmVxdWVudCBhbmQgVG9wLWsgRWxlbWVudHMgaW4gRGF0YSBTdHJlYW1zJ1xuLy8gYnkgQS4gTWV0d2FsbHksIEQuIEFncmF3YWwgJiBBLiBFbCBBYmJhZGkuXG4vLyBBcmd1bWVudCAqdyogc3BlY2lmaWVzIHRoZSBtYXhpbXVtIG51bWJlciBvZiBhY3RpdmUgY291bnRlcnMgdG8gbWFpbnRhaW4uXG4vLyBJZiBub3QgcHJvdmlkZWQsICp3KiBkZWZhdWx0cyB0byB0cmFja2luZyBhIG1heGltdW0gb2YgMTAwIHZhbHVlcy5cbmZ1bmN0aW9uIFN0cmVhbVN1bW1hcnkodykge1xuICB0aGlzLl93ID0gdyB8fCBERUZBVUxUX0NPVU5URVJTO1xuICB0aGlzLl92YWx1ZXMgPSB7fTtcblxuICB0aGlzLl9idWNrZXRzID0ge2NvdW50OiAtMX07XG4gIHRoaXMuX2J1Y2tldHMubmV4dCA9IHRoaXMuX2J1Y2tldHM7XG4gIHRoaXMuX2J1Y2tldHMucHJldiA9IHRoaXMuX2J1Y2tldHM7XG5cbiAgdGhpcy5fc2l6ZSA9IDA7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBTdHJlYW1TdW1tYXJ5IHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5TdHJlYW1TdW1tYXJ5LmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICB2YXIgc3MgPSBuZXcgU3RyZWFtU3VtbWFyeShvYmoudyksXG4gICAgICBiYiA9IHNzLl9idWNrZXRzLFxuICAgICAgaSwgbiwgYywgYiwgaiwgbSwgZTtcblxuICBmb3IgKGk9MCwgbj1vYmouYnVja2V0cy5sZW5ndGg7IGk8bjsgKytpKSB7XG4gICAgYyA9IG9iai5idWNrZXRzW2ldO1xuICAgIGIgPSBpbnNlcnQoYmIucHJldiwgYnVja2V0KGNbMF0pKTtcbiAgICBmb3IgKGo9MSwgbT1jLmxlbmd0aDsgajxtOyBqKz0yKSB7XG4gICAgICBlID0gaW5zZXJ0KGIubGlzdC5wcmV2LCBlbnRyeShjW2pdLCBiKSk7XG4gICAgICBlLmNvdW50ID0gYi5jb3VudDtcbiAgICAgIGUuZXJyb3IgPSBjW2orMV07XG4gICAgICBzcy5fc2l6ZSArPSAxO1xuICAgIH1cbiAgfVxuICBcbiAgcmV0dXJuIHNzO1xufTtcblxuLy8gR2VuZXJhdGUgYSBuZXcgZnJlcXVlbmN5IGJ1Y2tldC5cbmZ1bmN0aW9uIGJ1Y2tldChjb3VudCkge1xuICB2YXIgYiA9IHtjb3VudDogY291bnR9O1xuICBiLm5leHQgPSBiO1xuICBiLnByZXYgPSBiO1xuICBiLmxpc3QgPSB7fTtcbiAgYi5saXN0LnByZXYgPSBiLmxpc3Q7XG4gIGIubGlzdC5uZXh0ID0gYi5saXN0O1xuICByZXR1cm4gYjtcbn1cblxuLy8gR2VuZXJhdGUgYSBuZXcgY291bnRlciBub2RlIGZvciBhIHZhbHVlLlxuZnVuY3Rpb24gZW50cnkodmFsdWUsIGJ1Y2tldCkge1xuICByZXR1cm4ge1xuICAgIGJ1Y2tldDogYnVja2V0LFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgICBjb3VudDogMCxcbiAgICBlcnJvcjogMFxuICB9O1xufVxuXG4vLyBJbnNlcnQgKmN1cnIqIGFoZWFkIG9mIGxpbmtlZCBsaXN0IG5vZGUgKmxpc3QqLlxuZnVuY3Rpb24gaW5zZXJ0KGxpc3QsIGN1cnIpIHtcbiAgdmFyIG5leHQgPSBsaXN0Lm5leHQ7XG4gIGN1cnIubmV4dCA9IG5leHQ7XG4gIGN1cnIucHJldiA9IGxpc3Q7XG4gIGxpc3QubmV4dCA9IGN1cnI7XG4gIG5leHQucHJldiA9IGN1cnI7XG4gIHJldHVybiBjdXJyO1xufVxuXG4vLyBEZXRhY2ggKmN1cnIqIGZyb20gaXRzIGxpbmtlZCBsaXN0LlxuZnVuY3Rpb24gZGV0YWNoKGN1cnIpIHtcbiAgdmFyIG4gPSBjdXJyLm5leHQsXG4gICAgICBwID0gY3Vyci5wcmV2O1xuICBwLm5leHQgPSBuO1xuICBuLnByZXYgPSBwO1xufVxuXG52YXIgcHJvdG8gPSBTdHJlYW1TdW1tYXJ5LnByb3RvdHlwZTtcblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICp2KiBpcyB0aGUgdmFsdWUgdG8gYWRkLlxuLy8gQXJndW1lbnQgKmNvdW50KiBpcyB0aGUgb3B0aW9uYWwgbnVtYmVyIG9mIG9jY3VycmVuY2VzIHRvIHJlZ2lzdGVyLlxuLy8gSWYgKmNvdW50KiBpcyBub3QgcHJvdmlkZWQsIGFuIGluY3JlbWVudCBvZiAxIGlzIGFzc3VtZWQuXG5wcm90by5hZGQgPSBmdW5jdGlvbih2LCBjb3VudCkge1xuICBjb3VudCA9IGNvdW50IHx8IDE7XG4gIHZhciBub2RlID0gdGhpcy5fdmFsdWVzW3ZdLCBiO1xuXG4gIGlmIChub2RlID09IG51bGwpIHtcbiAgICBpZiAodGhpcy5fc2l6ZSA8IHRoaXMuX3cpIHtcbiAgICAgIGIgPSBpbnNlcnQodGhpcy5fYnVja2V0cywgYnVja2V0KDApKTtcbiAgICAgIG5vZGUgPSBpbnNlcnQoYi5saXN0LCBlbnRyeSh2LCBiKSk7XG4gICAgICB0aGlzLl9zaXplICs9IDE7XG4gICAgfSBlbHNlIHtcbiAgICAgIGIgPSB0aGlzLl9idWNrZXRzLm5leHQ7XG4gICAgICBub2RlID0gYi5saXN0Lm5leHQ7XG4gICAgICBkZWxldGUgdGhpcy5fdmFsdWVzW25vZGUudmFsdWVdO1xuICAgICAgbm9kZS52YWx1ZSA9IHY7XG4gICAgICBub2RlLmVycm9yID0gYi5jb3VudDtcbiAgICB9XG4gICAgdGhpcy5fdmFsdWVzW3ZdID0gbm9kZTsgICAgXG4gIH1cbiAgdGhpcy5faW5jcmVtZW50KG5vZGUsIGNvdW50KTtcbn07XG5cbi8vIEluY3JlbWVudCB0aGUgY291bnQgaW4gdGhlIHN0cmVhbSBzdW1tYXJ5IGRhdGEgc3RydWN0dXJlLlxucHJvdG8uX2luY3JlbWVudCA9IGZ1bmN0aW9uKG5vZGUsIGNvdW50KSB7XG4gIHZhciBoZWFkID0gdGhpcy5fYnVja2V0cyxcbiAgICAgIG9sZCAgPSBub2RlLmJ1Y2tldCxcbiAgICAgIHByZXYgPSBvbGQsXG4gICAgICBuZXh0ID0gcHJldi5uZXh0O1xuXG4gIGRldGFjaChub2RlKTtcbiAgbm9kZS5jb3VudCArPSBjb3VudDtcblxuICB3aGlsZSAobmV4dCAhPT0gaGVhZCkge1xuICAgIGlmIChub2RlLmNvdW50ID09PSBuZXh0LmNvdW50KSB7XG4gICAgICBpbnNlcnQobmV4dC5saXN0LCBub2RlKTtcbiAgICAgIGJyZWFrO1xuICAgIH0gZWxzZSBpZiAobm9kZS5jb3VudCA+IG5leHQuY291bnQpIHtcbiAgICAgIHByZXYgPSBuZXh0O1xuICAgICAgbmV4dCA9IHByZXYubmV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV4dCA9IGhlYWQ7XG4gICAgfVxuICB9XG5cbiAgaWYgKG5leHQgPT09IGhlYWQpIHtcbiAgICBuZXh0ID0gYnVja2V0KG5vZGUuY291bnQpO1xuICAgIGluc2VydChuZXh0Lmxpc3QsIG5vZGUpOyAvLyBhZGQgdmFsdWUgbm9kZSB0byBidWNrZXRcbiAgICBpbnNlcnQocHJldiwgbmV4dCk7ICAvLyBhZGQgYnVja2V0IHRvIGJ1Y2tldCBsaXN0XG4gIH1cbiAgbm9kZS5idWNrZXQgPSBuZXh0O1xuXG4gIC8vIGNsZWFuIHVwIGlmIG9sZCBidWNrZXQgaXMgZW1wdHlcbiAgaWYgKG9sZC5saXN0Lm5leHQgPT09IG9sZC5saXN0KSB7XG4gICAgZGV0YWNoKG9sZCk7XG4gIH1cbn07XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudCBmb3IgdmFsdWUgKnYqLlxuLy8gUmV0dXJucyB6ZXJvIGlmICp2KiBpcyBub3QgaW4gdGhlIHNrZXRjaC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odikge1xuICB2YXIgbm9kZSA9IHRoaXMuX3ZhbHVlc1t2XTtcbiAgcmV0dXJuIG5vZGUgPyBub2RlLmNvdW50IDogMDtcbn07XG5cbi8vIFF1ZXJ5IGZvciBlc3RpbWF0aW9uIGVycm9yIGZvciB2YWx1ZSAqdiouXG4vLyBSZXR1cm5zIC0xIGlmICp2KiBpcyBub3QgaW4gdGhlIHNrZXRjaC5cbnByb3RvLmVycm9yID0gZnVuY3Rpb24odikge1xuICB2YXIgbm9kZSA9IHRoaXMuX3ZhbHVlc1t2XTtcbiAgcmV0dXJuIG5vZGUgPyBub2RlLmVycm9yIDogLTE7XG59O1xuXG4vLyBSZXR1cm5zIHRoZSAoYXBwcm94aW1hdGUpIHRvcC1rIG1vc3QgZnJlcXVlbnQgdmFsdWVzLFxuLy8gcmV0dXJuZWQgaW4gb3JkZXIgb2YgZGVjcmVhc2luZyBmcmVxdWVuY3kuXG4vLyBBbGwgbW9uaXRvcmVkIHZhbHVlcyBhcmUgcmV0dXJuZWQgaWYgKmsqIGlzIG5vdCBwcm92aWRlZFxuLy8gb3IgaXMgbGFyZ2VyIHRoYW4gdGhlIHNrZXRjaCBzaXplLlxucHJvdG8udmFsdWVzID0gZnVuY3Rpb24oaykge1xuICByZXR1cm4gdGhpcy5jb2xsZWN0KGssIGZ1bmN0aW9uKHgpIHsgcmV0dXJuIHgudmFsdWU7IH0pO1xufTtcblxuLy8gUmV0dXJucyBjb3VudHMgZm9yIHRoZSAoYXBwcm94aW1hdGUpIHRvcC1rIGZyZXF1ZW50IHZhbHVlcyxcbi8vIHJldHVybmVkIGluIG9yZGVyIG9mIGRlY3JlYXNpbmcgZnJlcXVlbmN5LlxuLy8gQWxsIG1vbml0b3JlZCBjb3VudHMgYXJlIHJldHVybmVkIGlmICprKiBpcyBub3QgcHJvdmlkZWRcbi8vIG9yIGlzIGxhcmdlciB0aGFuIHRoZSBza2V0Y2ggc2l6ZS5cbnByb3RvLmNvdW50cyA9IGZ1bmN0aW9uKGspIHtcbiAgcmV0dXJuIHRoaXMuY29sbGVjdChrLCBmdW5jdGlvbih4KSB7IHJldHVybiB4LmNvdW50OyB9KTtcbn07XG5cbi8vIFJldHVybnMgZXN0aW1hdGlvbiBlcnJvciB2YWx1ZXMgZm9yIHRoZSAoYXBwcm94aW1hdGUpIHRvcC1rXG4vLyBmcmVxdWVudCB2YWx1ZXMsIHJldHVybmVkIGluIG9yZGVyIG9mIGRlY3JlYXNpbmcgZnJlcXVlbmN5LlxuLy8gQWxsIG1vbml0b3JlZCBjb3VudHMgYXJlIHJldHVybmVkIGlmICprKiBpcyBub3QgcHJvdmlkZWRcbi8vIG9yIGlzIGxhcmdlciB0aGFuIHRoZSBza2V0Y2ggc2l6ZS5cbnByb3RvLmVycm9ycyA9IGZ1bmN0aW9uKGspIHtcbiAgcmV0dXJuIHRoaXMuY29sbGVjdChrLCBmdW5jdGlvbih4KSB7IHJldHVybiB4LmVycm9yOyB9KTtcbn07XG5cbi8vIENvbGxlY3RzIHZhbHVlcyBmb3IgZWFjaCBlbnRyeSBpbiB0aGUgc2tldGNoLCBpbiBvcmRlciBvZlxuLy8gZGVjcmVhc2luZyAoYXBwcm94aW1hdGUpIGZyZXF1ZW5jeS5cbi8vIEFyZ3VtZW50ICprKiBpcyB0aGUgbnVtYmVyIG9mIHZhbHVlcyB0byBjb2xsZWN0LiBJZiB0aGUgKmsqIGlzIG5vdFxuLy8gcHJvdmlkZWQgb3IgZ3JlYXRlciB0aGFuIHRoZSBza2V0Y2ggc2l6ZSwgYWxsIHZhbHVlcyBhcmUgdmlzaXRlZC5cbi8vIEFyZ3VtZW50ICpmKiBpcyBhbiBhY2Nlc3NvciBmdW5jdGlvbiBmb3IgY29sbGVjdGluZyBhIHZhbHVlLlxucHJvdG8uY29sbGVjdCA9IGZ1bmN0aW9uKGssIGYpIHtcbiAgaWYgKGsgPT09IDApIHJldHVybiBbXTtcbiAgaWYgKGsgPT0gbnVsbCB8fCBrIDwgMCkgayA9IHRoaXMuX3NpemU7XG5cbiAgdmFyIGRhdGEgPSBBcnJheShrKSxcbiAgICAgIGhlYWQgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgbm9kZSwgbGlzdCwgZW50cnksIGk9MDtcblxuICBmb3IgKG5vZGUgPSBoZWFkLnByZXY7IG5vZGUgIT09IGhlYWQ7IG5vZGUgPSBub2RlLnByZXYpIHtcbiAgICBsaXN0ID0gbm9kZS5saXN0O1xuICAgIGZvciAoZW50cnkgPSBsaXN0LnByZXY7IGVudHJ5ICE9PSBsaXN0OyBlbnRyeSA9IGVudHJ5LnByZXYpIHtcbiAgICAgIGRhdGFbaSsrXSA9IGYoZW50cnkpO1xuICAgICAgaWYgKGkgPT09IGspIHJldHVybiBkYXRhO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkYXRhO1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIHNrZXRjaC5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgaGVhZCA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBvdXQgPSBbXSwgYiwgbiwgYztcblxuICBmb3IgKGIgPSBoZWFkLm5leHQ7IGIgIT09IGhlYWQ7IGIgPSBiLm5leHQpIHtcbiAgICBmb3IgKGMgPSBbYi5jb3VudF0sIG4gPSBiLmxpc3QubmV4dDsgbiAhPT0gYi5saXN0OyBuID0gbi5uZXh0KSB7XG4gICAgICBjLnB1c2gobi52YWx1ZSwgbi5lcnJvcik7XG4gICAgfVxuICAgIG91dC5wdXNoKGMpO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB3OiB0aGlzLl93LFxuICAgIGJ1Y2tldHM6IG91dFxuICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJlYW1TdW1tYXJ5O1xuIiwiLy8gVC1EaWdlc3RzIGFyZSBhIHNrZXRjaCBmb3IgcXVhbnRpbGUgYW5kIGNkZiBlc3RpbWF0aW9uLlxuLy8gU2ltaWxhciBpbiBzcGlyaXQgdG8gYSAxRCBrLW1lYW5zLCB0aGUgdC1kaWdlc3QgZml0cyBhIGJvdW5kZWQgc2V0IG9mXG4vLyBjZW50cm9pZHMgdG8gc3RyZWFtaW5nIGlucHV0IHRvIGxlYXJuIGEgdmFyaWFibGUtd2lkdGggaGlzdG9ncmFtLlxuLy8gU2VlOiAnQ29tcHV0aW5nIEV4dHJlbWVseSBBY2N1cmF0ZSBRdWFudGlsZXMgdXNpbmcgdC1EaWdlc3RzJ1xuLy8gYnkgVC4gRHVubmluZyAmIE8uIEVydGwuXG4vLyBCYXNlZCBvbiB0aGUgVGVkIER1bm5pbmcncyBtZXJnaW5nIGRpZ2VzdCBpbXBsZW1lbnRhdGlvbiBhdDpcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS90ZHVubmluZy90LWRpZ2VzdFxuLy8gT25lIG1ham9yIGRlcGFydHVyZSBmcm9tIHRoZSByZWZlcmVuY2UgaW1wbGVtZW50YXRpb24gaXMgdGhlIHVzZSBvZlxuLy8gYSBiaW5hcnkgc2VhcmNoIHRvIHNwZWVkIHVwIHF1YW50aWxlIGFuZCBjZGYgcXVlcmllcy5cblxudmFyIGFycmF5cyA9IHJlcXVpcmUoJy4vYXJyYXlzJyk7XG5cbnZhciBFUFNJTE9OID0gMWUtMzAwLFxuICAgIERFRkFVTFRfQ0VOVFJPSURTID0gMTAwO1xuXG4vLyBDcmVhdGUgYSBuZXcgdC1kaWdlc3Qgc2tldGNoIGZvciBxdWFudGlsZSBhbmQgaGlzdG9ncmFtIGVzdGltYXRpb24uXG4vLyBBcmd1bWVudCAqbiogaXMgdGhlIGFwcHJveGltYXRlIG51bWJlciBvZiBjZW50cm9pZHMsIGRlZmF1bHRzIHRvIDEwMC5cbmZ1bmN0aW9uIFREaWdlc3Qobikge1xuICB0aGlzLl9uYyA9IG4gfHwgREVGQVVMVF9DRU5UUk9JRFM7XG4gIHZhciBzaXplID0gTWF0aC5jZWlsKHRoaXMuX25jICogTWF0aC5QSS8yKTtcbiAgXG4gIHRoaXMuX3RvdGFsU3VtID0gMDtcbiAgdGhpcy5fbGFzdCA9IDA7XG4gIHRoaXMuX3dlaWdodCA9IGFycmF5cy5mbG9hdHMoc2l6ZSk7XG4gIHRoaXMuX21lYW4gPSBhcnJheXMuZmxvYXRzKHNpemUpO1xuICB0aGlzLl9taW4gPSBOdW1iZXIuTUFYX1ZBTFVFO1xuICB0aGlzLl9tYXggPSAtTnVtYmVyLk1BWF9WQUxVRTtcblxuICAvLyBkb3VibGUgYnVmZmVyIHRvIHNpbXBsaWZ5IG1lcmdlIG9wZXJhdGlvbnNcbiAgLy8gX21lcmdlV2VpZ2h0IGFsc28gdXNlZCBmb3IgdHJhbnNpZW50IHN0b3JhZ2Ugb2YgY3VtdWxhdGl2ZSB3ZWlnaHRzXG4gIHRoaXMuX21lcmdlV2VpZ2h0ID0gYXJyYXlzLmZsb2F0cyhzaXplKTtcbiAgdGhpcy5fbWVyZ2VNZWFuID0gYXJyYXlzLmZsb2F0cyhzaXplKTtcblxuICAvLyB0ZW1wb3JhcnkgYnVmZmVycyBmb3IgcmVjZW50bHkgYWRkZWQgdmFsdWVzXG4gIHZhciB0ZW1wc2l6ZSA9IG51bVRlbXAodGhpcy5fbmMpO1xuICB0aGlzLl91bm1lcmdlZFN1bSA9IDA7XG4gIHRoaXMuX3RlbXBMYXN0ID0gMDtcbiAgdGhpcy5fdGVtcFdlaWdodCA9IGFycmF5cy5mbG9hdHModGVtcHNpemUpO1xuICB0aGlzLl90ZW1wTWVhbiA9IGFycmF5cy5mbG9hdHModGVtcHNpemUpO1xuICB0aGlzLl9vcmRlciA9IFtdOyAvLyBmb3Igc29ydGluZ1xufVxuXG4vLyBHaXZlbiB0aGUgbnVtYmVyIG9mIGNlbnRyb2lkcywgZGV0ZXJtaW5lIHRlbXAgYnVmZmVyIHNpemVcbi8vIFBlcmZvcm0gYmluYXJ5IHNlYXJjaCB0byBmaW5kIHZhbHVlIGsgc3VjaCB0aGF0IE4gPSBrIGxvZzIga1xuLy8gVGhpcyBzaG91bGQgZ2l2ZSB1cyBnb29kIGFtb3J0aXplZCBhc3ltcHRvdGljIGNvbXBsZXhpdHlcbmZ1bmN0aW9uIG51bVRlbXAoTikge1xuICB2YXIgbG8gPSAxLCBoaSA9IE4sIG1pZDtcbiAgd2hpbGUgKGxvIDwgaGkpIHtcbiAgICBtaWQgPSBsbyArIGhpID4+PiAxO1xuICAgIGlmIChOID4gbWlkICogTWF0aC5sb2cobWlkKSAvIE1hdGguTE4yKSB7IGxvID0gbWlkICsgMTsgfVxuICAgIGVsc2UgeyBoaSA9IG1pZDsgfVxuICB9XG4gIHJldHVybiBsbztcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IHQtZGlnZXN0IHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5URGlnZXN0LmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICB2YXIgdGQgPSBuZXcgVERpZ2VzdChvYmouY2VudHJvaWRzKTtcbiAgdmFyIHN1bSA9IDA7XG4gIHRkLl9taW4gPSBvYmoubWluO1xuICB0ZC5fbWF4ID0gb2JqLm1heDtcbiAgdGQuX2xhc3QgPSBvYmoubWVhbi5sZW5ndGggLSAxO1xuICBmb3IgKHZhciBpPTAsIG49b2JqLm1lYW4ubGVuZ3RoOyBpPG47ICsraSkge1xuICAgIHRkLl9tZWFuW2ldID0gb2JqLm1lYW5baV07XG4gICAgc3VtICs9ICh0ZC5fd2VpZ2h0W2ldID0gb2JqLndlaWdodFtpXSk7XG4gIH1cbiAgdGQuX3RvdGFsU3VtID0gc3VtO1xuICByZXR1cm4gdGQ7XG59O1xuXG52YXIgcHJvdG8gPSBURGlnZXN0LnByb3RvdHlwZTtcblxuLy8gLS0gQ29uc3RydWN0aW9uIE1ldGhvZHMgLS0tLS1cblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIHQtZGlnZXN0LlxuLy8gQXJndW1lbnQgKnYqIGlzIHRoZSB2YWx1ZSB0byBhZGQuXG4vLyBBcmd1bWVudCAqY291bnQqIGlzIHRoZSBpbnRlZ2VyIG51bWJlciBvZiBvY2N1cnJlbmNlcyB0byBhZGQuXG4vLyBJZiBub3QgcHJvdmlkZWQsICpjb3VudCogZGVmYXVsdHMgdG8gMS5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYsIGNvdW50KSB7XG4gIGlmICh2ID09IG51bGwgfHwgdiAhPT0gdikgcmV0dXJuOyAvLyBpZ25vcmUgbnVsbCwgTmFOXG4gIGNvdW50ID0gY291bnQgPT0gbnVsbCA/IDEgOiBjb3VudDtcbiAgaWYgKGNvdW50IDw9IDApIHRocm93IG5ldyBFcnJvcignQ291bnQgbXVzdCBiZSBncmVhdGVyIHRoYW4gemVyby4nKTtcbiAgXG4gIGlmICh0aGlzLl90ZW1wTGFzdCA+PSB0aGlzLl90ZW1wV2VpZ2h0Lmxlbmd0aCkge1xuICAgIHRoaXMuX21lcmdlVmFsdWVzKCk7XG4gIH1cblxuICB2YXIgbiA9IHRoaXMuX3RlbXBMYXN0Kys7XG4gIHRoaXMuX3RlbXBXZWlnaHRbbl0gPSBjb3VudDtcbiAgdGhpcy5fdGVtcE1lYW5bbl0gPSB2O1xuICB0aGlzLl91bm1lcmdlZFN1bSArPSBjb3VudDtcbn07XG5cbnByb3RvLl9tZXJnZVZhbHVlcyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5fdW5tZXJnZWRTdW0gPT09IDApIHJldHVybjtcblxuICB2YXIgdHcgPSB0aGlzLl90ZW1wV2VpZ2h0LFxuICAgICAgdHUgPSB0aGlzLl90ZW1wTWVhbixcbiAgICAgIHRuID0gdGhpcy5fdGVtcExhc3QsXG4gICAgICB3ID0gdGhpcy5fd2VpZ2h0LFxuICAgICAgdSA9IHRoaXMuX21lYW4sXG4gICAgICBuID0gMCxcbiAgICAgIG9yZGVyID0gdGhpcy5fb3JkZXIsXG4gICAgICBzdW0gPSAwLCBpaSwgaSwgaiwgazE7XG5cbiAgLy8gZ2V0IHNvcnQgb3JkZXIgZm9yIGFkZGVkIHZhbHVlcyBpbiB0ZW1wIGJ1ZmZlcnNcbiAgb3JkZXIubGVuZ3RoID0gdG47XG4gIGZvciAoaT0wOyBpPHRuOyArK2kpIG9yZGVyW2ldID0gaTtcbiAgb3JkZXIuc29ydChmdW5jdGlvbihhLGIpIHsgcmV0dXJuIHR1W2FdIC0gdHVbYl07IH0pO1xuXG4gIGlmICh0aGlzLl90b3RhbFN1bSA+IDApIG4gPSB0aGlzLl9sYXN0ICsgMTtcbiAgdGhpcy5fbGFzdCA9IDA7XG4gIHRoaXMuX3RvdGFsU3VtICs9IHRoaXMuX3VubWVyZ2VkU3VtO1xuICB0aGlzLl91bm1lcmdlZFN1bSA9IDA7XG5cbiAgLy8gbWVyZ2UgZXhpc3RpbmcgY2VudHJvaWRzIHdpdGggYWRkZWQgdmFsdWVzIGluIHRlbXAgYnVmZmVyc1xuICBmb3IgKGk9aj1rMT0wOyBpIDwgdG4gJiYgaiA8IG47KSB7XG4gICAgaWkgPSBvcmRlcltpXTtcbiAgICBpZiAodHVbaWldIDw9IHVbal0pIHtcbiAgICAgIHN1bSArPSB0d1tpaV07XG4gICAgICBrMSA9IHRoaXMuX21lcmdlQ2VudHJvaWQoc3VtLCBrMSwgdHdbaWldLCB0dVtpaV0pO1xuICAgICAgaSsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBzdW0gKz0gd1tqXTtcbiAgICAgIGsxID0gdGhpcy5fbWVyZ2VDZW50cm9pZChzdW0sIGsxLCB3W2pdLCB1W2pdKTtcbiAgICAgIGorKztcbiAgICB9XG4gIH1cbiAgLy8gb25seSB0ZW1wIGJ1ZmZlciB2YWx1ZXMgcmVtYWluXG4gIGZvciAoOyBpIDwgdG47ICsraSkge1xuICAgIGlpID0gb3JkZXJbaV07XG4gICAgc3VtICs9IHR3W2lpXTtcbiAgICBrMSA9IHRoaXMuX21lcmdlQ2VudHJvaWQoc3VtLCBrMSwgdHdbaWldLCB0dVtpaV0pO1xuICB9XG4gIC8vIG9ubHkgZXhpc3RpbmcgY2VudHJvaWRzIHJlbWFpblxuICBmb3IgKDsgaiA8IG47ICsraikge1xuICAgIHN1bSArPSB3W2pdO1xuICAgIGsxID0gdGhpcy5fbWVyZ2VDZW50cm9pZChzdW0sIGsxLCB3W2pdLCB1W2pdKTtcbiAgfVxuICB0aGlzLl90ZW1wTGFzdCA9IDA7XG5cbiAgLy8gc3dhcCBwb2ludGVycyBmb3Igd29ya2luZyBzcGFjZSBhbmQgbWVyZ2Ugc3BhY2VcbiAgdGhpcy5fd2VpZ2h0ID0gdGhpcy5fbWVyZ2VXZWlnaHQ7XG4gIHRoaXMuX21lcmdlV2VpZ2h0ID0gdztcbiAgdGhpcy5fbWVhbiA9IHRoaXMuX21lcmdlTWVhbjtcbiAgdGhpcy5fbWVyZ2VNZWFuID0gdTtcblxuICB1WzBdID0gdGhpcy5fd2VpZ2h0WzBdO1xuICBmb3IgKGk9MSwgbj10aGlzLl9sYXN0LCB3WzBdPTA7IGk8PW47ICsraSkge1xuICAgIHdbaV0gPSAwOyAvLyB6ZXJvIG91dCBtZXJnZSB3ZWlnaHRzXG4gICAgdVtpXSA9IHVbaS0xXSArIHRoaXMuX3dlaWdodFtpXTsgLy8gc3Rhc2ggY3VtdWxhdGl2ZSBkaXN0XG4gIH1cbiAgdGhpcy5fbWluID0gTWF0aC5taW4odGhpcy5fbWluLCB0aGlzLl9tZWFuWzBdKTtcbiAgdGhpcy5fbWF4ID0gTWF0aC5tYXgodGhpcy5fbWF4LCB0aGlzLl9tZWFuW25dKTtcbn07XG5cbnByb3RvLl9tZXJnZUNlbnRyb2lkID0gZnVuY3Rpb24oc3VtLCBrMSwgd3QsIHV0KSB7XG4gIHZhciB3ID0gdGhpcy5fbWVyZ2VXZWlnaHQsXG4gICAgICB1ID0gdGhpcy5fbWVyZ2VNZWFuLFxuICAgICAgbiA9IHRoaXMuX2xhc3QsXG4gICAgICBrMiA9IGludGVncmF0ZSh0aGlzLl9uYywgc3VtIC8gdGhpcy5fdG90YWxTdW0pO1xuXG4gIGlmIChrMiAtIGsxIDw9IDEgfHwgd1tuXSA9PT0gMCkge1xuICAgIC8vIG1lcmdlIGludG8gZXhpc3RpbmcgY2VudHJvaWQgaWYgY2VudHJvaWQgaW5kZXggZGlmZmVyZW5jZSAoazItazEpXG4gICAgLy8gaXMgd2l0aGluIDEgb3IgaWYgY3VycmVudCBjZW50cm9pZCBpcyBlbXB0eVxuICAgIHdbbl0gKz0gd3Q7XG4gICAgdVtuXSArPSAodXQgLSB1W25dKSAqIHd0IC8gd1tuXTtcbiAgfSBlbHNlIHtcbiAgICAvLyBvdGhlcndpc2UgY3JlYXRlIGEgbmV3IGNlbnRyb2lkXG4gICAgdGhpcy5fbGFzdCA9ICsrbjtcbiAgICB1W25dID0gdXQ7XG4gICAgd1tuXSA9IHd0O1xuICAgIGsxID0gaW50ZWdyYXRlKHRoaXMuX25jLCAoc3VtIC0gd3QpIC8gdGhpcy5fdG90YWxTdW0pO1xuICB9XG5cbiAgcmV0dXJuIGsxO1xufTtcblxuLy8gQ29udmVydHMgYSBxdWFudGlsZSBpbnRvIGEgY2VudHJvaWQgaW5kZXggdmFsdWUuIFRoZSBjZW50cm9pZCBpbmRleCBpc1xuLy8gbm9taW5hbGx5IHRoZSBudW1iZXIgayBvZiB0aGUgY2VudHJvaWQgdGhhdCBhIHF1YW50aWxlIHBvaW50IHEgc2hvdWxkXG4vLyBiZWxvbmcgdG8uIER1ZSB0byByb3VuZC1vZmZzLCBob3dldmVyLCB3ZSBjYW4ndCBhbGlnbiB0aGluZ3MgcGVyZmVjdGx5XG4vLyB3aXRob3V0IHNwbGl0dGluZyBwb2ludHMgYW5kIGNlbnRyb2lkcy4gV2UgZG9uJ3Qgd2FudCB0byBkbyB0aGF0LCBzbyB3ZVxuLy8gaGF2ZSB0byBhbGxvdyBmb3Igb2Zmc2V0cy5cbi8vIEluIHRoZSBlbmQsIHRoZSBjcml0ZXJpb24gaXMgdGhhdCBhbnkgcXVhbnRpbGUgcmFuZ2UgdGhhdCBzcGFucyBhIGNlbnRyb2lkXG4vLyBpbmRleCByYW5nZSBtb3JlIHRoYW4gb25lIHNob3VsZCBiZSBzcGxpdCBhY3Jvc3MgbW9yZSB0aGFuIG9uZSBjZW50cm9pZCBpZlxuLy8gcG9zc2libGUuIFRoaXMgd29uJ3QgYmUgcG9zc2libGUgaWYgdGhlIHF1YW50aWxlIHJhbmdlIHJlZmVycyB0byBhIHNpbmdsZVxuLy8gcG9pbnQgb3IgYW4gYWxyZWFkeSBleGlzdGluZyBjZW50cm9pZC5cbi8vIFdlIHVzZSB0aGUgYXJjc2luIGZ1bmN0aW9uIHRvIG1hcCBmcm9tIHRoZSBxdWFudGlsZSBkb21haW4gdG8gdGhlIGNlbnRyb2lkXG4vLyBpbmRleCByYW5nZS4gVGhpcyBwcm9kdWNlcyBhIG1hcHBpbmcgdGhhdCBpcyBzdGVlcCBuZWFyIHE9MCBvciBxPTEgc28gZWFjaFxuLy8gY2VudHJvaWQgdGhlcmUgd2lsbCBjb3JyZXNwb25kIHRvIGxlc3MgcSByYW5nZS4gTmVhciBxPTAuNSwgdGhlIG1hcHBpbmcgaXNcbi8vIGZsYXR0ZXIgc28gdGhhdCBjZW50cm9pZHMgdGhlcmUgd2lsbCByZXByZXNlbnQgYSBsYXJnZXIgY2h1bmsgb2YgcXVhbnRpbGVzLlxuZnVuY3Rpb24gaW50ZWdyYXRlKG5jLCBxKSB7XG4gIC8vIEZpcnN0LCBzY2FsZSBhbmQgYmlhcyB0aGUgcXVhbnRpbGUgZG9tYWluIHRvIFstMSwgMV1cbiAgLy8gTmV4dCwgYmlhcyBhbmQgc2NhbGUgdGhlIGFyY3NpbiByYW5nZSB0byBbMCwgMV1cbiAgLy8gVGhpcyBnaXZlcyB1cyBhIFswLDFdIGludGVycG9sYW50IGZvbGxvd2luZyB0aGUgYXJjc2luIHNoYXBlXG4gIC8vIEZpbmFsbHksIG11bHRpcGx5IGJ5IGNlbnRyb2lkIGNvdW50IGZvciBjZW50cm9pZCBzY2FsZSB2YWx1ZVxuICByZXR1cm4gbmMgKiAoTWF0aC5hc2luKDIgKiBxIC0gMSkgKyBNYXRoLlBJLzIpIC8gTWF0aC5QSTtcbn1cblxuLy8gLS0gUXVlcnkgTWV0aG9kcyAtLS0tLVxuXG4vLyBUaGUgbnVtYmVyIG9mIHZhbHVlcyB0aGF0IGhhdmUgYmVlbiBhZGRlZCB0byB0aGlzIHNrZXRjaC5cbnByb3RvLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuX3RvdGFsU3VtICsgdGhpcy5fdW5tZXJnZWRTdW07XG59O1xuXG4vLyBRdWVyeSBmb3IgZXN0aW1hdGVkIHF1YW50aWxlICpxKi5cbi8vIEFyZ3VtZW50ICpxKiBpcyBhIGRlc2lyZWQgcXVhbnRpbGUgaW4gdGhlIHJhbmdlICgwLDEpXG4vLyBGb3IgZXhhbXBsZSwgcSA9IDAuNSBxdWVyaWVzIGZvciB0aGUgbWVkaWFuLlxucHJvdG8ucXVhbnRpbGUgPSBmdW5jdGlvbihxKSB7XG4gIHRoaXMuX21lcmdlVmFsdWVzKCk7XG5cbiAgdmFyIHRvdGFsID0gdGhpcy5fdG90YWxTdW0sXG4gICAgICBuID0gdGhpcy5fbGFzdCxcbiAgICAgIHUgPSB0aGlzLl9tZWFuLFxuICAgICAgdyA9IHRoaXMuX3dlaWdodCxcbiAgICAgIGMgPSB0aGlzLl9tZXJnZU1lYW4sXG4gICAgICBpLCBsLCByLCBtaW4sIG1heDtcblxuICBsID0gbWluID0gdGhpcy5fbWluO1xuICByID0gbWF4ID0gdGhpcy5fbWF4O1xuICBpZiAodG90YWwgPT09IDApIHJldHVybiBOYU47XG4gIGlmIChxIDw9IDApIHJldHVybiBtaW47XG4gIGlmIChxID49IDEpIHJldHVybiBtYXg7XG4gIGlmIChuID09PSAwKSByZXR1cm4gdVswXTtcblxuICAvLyBjYWxjdWxhdGUgYm91bmRhcmllcywgcGljayBjZW50cm9pZCB2aWEgYmluYXJ5IHNlYXJjaFxuICBxID0gcSAqIHRvdGFsO1xuICBpID0gYmlzZWN0KGMsIHEsIDAsIG4rMSk7XG4gIGlmIChpID4gMCkgbCA9IGJvdW5kYXJ5KGktMSwgaSwgdSwgdyk7XG4gIGlmIChpIDwgbikgciA9IGJvdW5kYXJ5KGksIGkrMSwgdSwgdyk7XG4gIHJldHVybiBsICsgKHItbCkgKiAocSAtIChjW2ktMV18fDApKSAvIHdbaV07XG59O1xuXG4vLyBRdWVyeSB0aGUgZXN0aW1hdGVkIGN1bXVsYXRpdmUgZGlzdHJpYnV0aW9uIGZ1bmN0aW9uLlxuLy8gSW4gb3RoZXIgd29yZHMsIHF1ZXJ5IGZvciB0aGUgZnJhY3Rpb24gb2YgdmFsdWVzIDw9ICp2Ki5cbnByb3RvLmNkZiA9IGZ1bmN0aW9uKHYpIHtcbiAgdGhpcy5fbWVyZ2VWYWx1ZXMoKTtcblxuICB2YXIgdG90YWwgPSB0aGlzLl90b3RhbFN1bSxcbiAgICAgIG4gPSB0aGlzLl9sYXN0LFxuICAgICAgdSA9IHRoaXMuX21lYW4sXG4gICAgICB3ID0gdGhpcy5fd2VpZ2h0LFxuICAgICAgYyA9IHRoaXMuX21lcmdlTWVhbixcbiAgICAgIGksIGwsIHIsIG1pbiwgbWF4O1xuXG4gIGwgPSBtaW4gPSB0aGlzLl9taW47XG4gIHIgPSBtYXggPSB0aGlzLl9tYXg7XG4gIGlmICh0b3RhbCA9PT0gMCkgcmV0dXJuIE5hTjtcbiAgaWYgKHYgPCBtaW4pIHJldHVybiAwO1xuICBpZiAodiA+IG1heCkgcmV0dXJuIDE7XG4gIGlmIChuID09PSAwKSByZXR1cm4gaW50ZXJwKHYsIG1pbiwgbWF4KTtcblxuICAvLyBjYWxjdWxhdGUgYm91bmRhcmllcywgcGljayBzdGFydCBwb2ludCB2aWEgYmluYXJ5IHNlYXJjaFxuICBpID0gYmlzZWN0KHUsIHYsIDAsIG4rMSk7XG4gIGlmIChpID4gMCkgbCA9IGJvdW5kYXJ5KGktMSwgaSwgdSwgdyk7XG4gIGlmIChpIDwgbikgciA9IGJvdW5kYXJ5KGksIGkrMSwgdSwgdyk7XG4gIGlmICh2IDwgbCkgeyAvLyBzaGlmdCBvbmUgaW50ZXJ2YWwgaWYgdmFsdWUgZXhjZWVkcyBib3VuZGFyeVxuICAgIHIgPSBsO1xuICAgIGwgPSAtLWkgPyBib3VuZGFyeShpLTEsIGksIHUsIHcpIDogbWluO1xuICB9XG4gIHJldHVybiAoKGNbaS0xXXx8MCkgKyB3W2ldICogaW50ZXJwKHYsIGwsIHIpKSAvIHRvdGFsO1xufTtcblxuZnVuY3Rpb24gYmlzZWN0KGEsIHgsIGxvLCBoaSkge1xuICB3aGlsZSAobG8gPCBoaSkge1xuICAgIHZhciBtaWQgPSBsbyArIGhpID4+PiAxO1xuICAgIGlmIChhW21pZF0gPCB4KSB7IGxvID0gbWlkICsgMTsgfVxuICAgIGVsc2UgeyBoaSA9IG1pZDsgfVxuICB9XG4gIHJldHVybiBsbztcbn1cblxuZnVuY3Rpb24gYm91bmRhcnkoaSwgaiwgdSwgdykge1xuICByZXR1cm4gdVtpXSArICh1W2pdIC0gdVtpXSkgKiB3W2ldIC8gKHdbaV0gKyB3W2pdKTtcbn1cblxuZnVuY3Rpb24gaW50ZXJwKHgsIHgwLCB4MSkge1xuICB2YXIgZGVub20gPSB4MSAtIHgwO1xuICByZXR1cm4gZGVub20gPiBFUFNJTE9OID8gKHggLSB4MCkgLyBkZW5vbSA6IDAuNTtcbn1cblxuLy8gVW5pb24gdGhpcyB0LWRpZ2VzdCB3aXRoIGFub3RoZXIuXG5wcm90by51bmlvbiA9IGZ1bmN0aW9uKHRkKSB7XG4gIHZhciB1ID0gVERpZ2VzdC5pbXBvcnQodGhpcy5leHBvcnQoKSk7XG4gIHRkLl9tZXJnZVZhbHVlcygpO1xuICBmb3IgKHZhciBpPTAsIG49dGQuX2xhc3Q7IGk8bjsgKytpKSB7XG4gICAgdS5hZGQodGQuX21lYW5baV0sIHRkLl93ZWlnaHRbaV0pO1xuICB9XG4gIHJldHVybiB1O1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIHNrZXRjaC5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9tZXJnZVZhbHVlcygpO1xuICByZXR1cm4ge1xuICAgIGNlbnRyb2lkczogdGhpcy5fbmMsXG4gICAgbWluOiAgICAgICB0aGlzLl9taW4sXG4gICAgbWF4OiAgICAgICB0aGlzLl9tYXgsXG4gICAgbWVhbjogICAgICBbXS5zbGljZS5jYWxsKHRoaXMuX21lYW4sIDAsIHRoaXMuX2xhc3QrMSksXG4gICAgd2VpZ2h0OiAgICBbXS5zbGljZS5jYWxsKHRoaXMuX3dlaWdodCwgMCwgdGhpcy5fbGFzdCsxKVxuICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBURGlnZXN0O1xuIl19
