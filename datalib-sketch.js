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
  Bloom:         require('./bloom'),
  CountMin:      require('./count-min'),
  CountMeanMin:  require('./count-mean-min'),
  NGram:         require('./ngram'),
  StreamSummary: require('./stream-summary')
};
},{"./bloom":1,"./count-mean-min":2,"./count-min":3,"./ngram":6,"./stream-summary":7}],6:[function(require,module,exports){
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

},{}],7:[function(require,module,exports){
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

},{}]},{},[5])(5)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYmxvb20uanMiLCJzcmMvY291bnQtbWVhbi1taW4uanMiLCJzcmMvY291bnQtbWluLmpzIiwic3JjL2hhc2guanMiLCJzcmMvaW5kZXguanMiLCJzcmMvbmdyYW0uanMiLCJzcmMvc3RyZWFtLXN1bW1hcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gQmxvb20gRmlsdGVycyB0ZXN0IHdoZXRoZXIgYW4gZWxlbWVudCBpcyBhIG1lbWJlciBvZiBhIHNldC5cbi8vIEZhbHNlIHBvc2l0aXZlIG1hdGNoZXMgYXJlIHBvc3NpYmxlLCBidXQgZmFsc2UgbmVnYXRpdmVzIGFyZSBub3QuXG4vLyBTZWUgaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9CbG9vbV9maWx0ZXJcblxuLy8gVGhpcyBjb2RlIGJvcnJvd3MgaGVhdmlseSBmcm9tIGh0dHA6Ly9naXRodWIuY29tL2phc29uZGF2aWVzL2Jsb29tZmlsdGVyLmpzXG5cbnZhciBoYXNoID0gcmVxdWlyZSgnLi9oYXNoJyk7XG5cbnZhciBUWVBFRF9BUlJBWVMgPSB0eXBlb2YgQXJyYXlCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIsXG4gICAgREVGQVVMVF9CSVRTID0gMTAyNCAqIDEwMjQgKiA4LCAvLyAxTUJcbiAgICBERUZBVUxUX0hBU0ggPSA1OyAvLyBPcHRpbWFsIGZvciAyJSBGUFIgb3ZlciAxTSBlbGVtZW50c1xuXG4vLyBDcmVhdGUgYSBuZXcgYmxvb20gZmlsdGVyLiBJZiAqdyogaXMgYW4gYXJyYXktbGlrZSBvYmplY3QsIHdpdGggYSBsZW5ndGhcbi8vIHByb3BlcnR5LCB0aGVuIHRoZSBibG9vbSBmaWx0ZXIgaXMgbG9hZGVkIHdpdGggZGF0YSBmcm9tIHRoZSBhcnJheSwgd2hlcmVcbi8vIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLiBPdGhlcndpc2UsICp3KiBzaG91bGQgc3BlY2lmeSB0aGUgd2lkdGhcbi8vIG9mIHRoZSBmaWx0ZXIgaW4gYml0cy4gTm90ZSB0aGF0ICp3KiBpcyByb3VuZGVkIHVwIHRvIHRoZSBuZWFyZXN0IG11bHRpcGxlXG4vLyBvZiAzMi4gKmQqICh0aGUgZmlsdGVyIGRlcHRoKSBzcGVjaWZpZXMgdGhlIG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucy5cbmZ1bmN0aW9uIEJsb29tRmlsdGVyKHcsIGQpIHtcbiAgdyA9IHcgfHwgREVGQVVMVF9CSVRTO1xuICBkID0gZCB8fCBERUZBVUxUX0hBU0g7XG5cbiAgdmFyIGE7XG4gIGlmICh0eXBlb2YgdyAhPT0gXCJudW1iZXJcIikgeyBhID0gdzsgdyA9IGEubGVuZ3RoICogMzI7IH1cblxuICB2YXIgbiA9IE1hdGguY2VpbCh3IC8gMzIpLFxuICAgICAgaSA9IC0xLCBidWNrZXRzO1xuICB0aGlzLl93ID0gdyA9IG4gKiAzMjtcbiAgdGhpcy5fZCA9IGQ7XG5cbiAgaWYgKFRZUEVEX0FSUkFZUykge1xuICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzID0gbmV3IEludDMyQXJyYXkobik7XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gYVtpXTtcbiAgfSBlbHNlIHtcbiAgICBidWNrZXRzID0gdGhpcy5fYnVja2V0cyA9IFtdO1xuICAgIGlmIChhKSB3aGlsZSAoKytpIDwgbikgYnVja2V0c1tpXSA9IGFbaV07XG4gICAgZWxzZSB3aGlsZSAoKytpIDwgbikgYnVja2V0c1tpXSA9IDA7XG4gIH1cbiAgaGFzaC5pbml0LmNhbGwodGhpcyk7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIgYmFzZWQgb24gcHJvdmlkZWQgcGVyZm9ybWFuY2UgcGFyYW1ldGVycy5cbi8vIEFyZ3VtZW50ICpuKiBpcyB0aGUgZXhwZWN0ZWQgc2V0IHNpemUgKGNhcmRpbmFsaXR5KS5cbi8vIEFyZ3VtZW50ICpwKiBpcyB0aGUgZGVzaXJlZCBmYWxzZSBwb3NpdGl2ZSByYXRlLlxuLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9CbG9vbV9maWx0ZXIjT3B0aW1hbF9udW1iZXJfb2ZfaGFzaF9mdW5jdGlvbnNcbkJsb29tRmlsdGVyLmNyZWF0ZSA9IGZ1bmN0aW9uKG4sIHApIHtcbiAgdmFyIHcgPSAtbiAqIE1hdGgubG9nKHApIC8gKE1hdGguTE4yICogTWF0aC5MTjIpLFxuICAgICAgZCA9ICh3IC8gbikgKiBNYXRoLkxOMjtcbiAgcmV0dXJuIG5ldyBCbG9vbUZpbHRlcih+fncsIH5+ZCk7XG59O1xuXG4vLyBDcmVhdGUgYSBuZXcgYmxvb20gZmlsdGVyIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdC5cbkJsb29tRmlsdGVyLmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKG9iai5iaXRzLCBvYmouZGVwdGgpO1xufTtcblxudmFyIHByb3RvID0gQmxvb21GaWx0ZXIucHJvdG90eXBlO1xuXG5wcm90by5sb2NhdGlvbnMgPSBoYXNoLmxvY2F0aW9ucztcblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIGZpbHRlci5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBidWNrZXRzID0gdGhpcy5fYnVja2V0cztcbiAgd2hpbGUgKCsraSA8IGQpIGJ1Y2tldHNbTWF0aC5mbG9vcihsW2ldIC8gMzIpXSB8PSAxIDw8IChsW2ldICUgMzIpO1xufTtcblxuLy8gUXVlcnkgZm9yIGluY2x1c2lvbiBpbiB0aGUgZmlsdGVyLlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModiArICcnKSxcbiAgICAgIGkgPSAtMSxcbiAgICAgIGQgPSB0aGlzLl9kLFxuICAgICAgYixcbiAgICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzO1xuICB3aGlsZSAoKytpIDwgZCkge1xuICAgIGIgPSBsW2ldO1xuICAgIGlmICgoYnVja2V0c1tNYXRoLmZsb29yKGIgLyAzMildICYgKDEgPDwgKGIgJSAzMikpKSA9PT0gMCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEVzdGltYXRlZCBjYXJkaW5hbGl0eS5cbnByb3RvLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgYml0cyA9IDAsIGksIG47XG4gIGZvciAoaT0wLCBuPWJ1Y2tldHMubGVuZ3RoOyBpPG47ICsraSkgYml0cyArPSBiaXRjb3VudChidWNrZXRzW2ldKTtcbiAgcmV0dXJuIC10aGlzLl93ICogTWF0aC5sb2coMSAtIGJpdHMgLyB0aGlzLl93KSAvIHRoaXMuX2Q7XG59O1xuXG4vLyBVbmlvbiB0aGlzIGJsb29tIGZpbHRlciB3aXRoIGFub3RoZXIuXG4vLyBUaGUgaW5wdXQgZmlsdGVyIG11c3QgaGF2ZSB0aGUgc2FtZSBkZXB0aCBhbmQgd2lkdGguXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by51bmlvbiA9IGZ1bmN0aW9uKGJmKSB7XG4gIGlmIChiZi5fdyAhPT0gdGhpcy5fdykgdGhyb3cgJ0ZpbHRlciB3aWR0aHMgZG8gbm90IG1hdGNoLic7XG4gIGlmIChiZi5fZCAhPT0gdGhpcy5fZCkgdGhyb3cgJ0ZpbHRlciBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIGEgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgYiA9IGJmLl9idWNrZXRzLFxuICAgICAgbiA9IGEubGVuZ3RoLFxuICAgICAgeiA9IFRZUEVEX0FSUkFZUyA/IG5ldyBJbnQzMkFycmF5KG4pIDogQXJyYXkobiksXG4gICAgICBpO1xuXG4gIGZvciAoaT0wOyBpPG47ICsraSkge1xuICAgIHpbaV0gPSBhW2ldIHwgYltpXTtcbiAgfVxuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKHosIHRoaXMuX2QpO1xufTtcblxuLy8gSW50ZXJuYWwgaGVscGVyIG1ldGhvZCBmb3IgYmxvb20gZmlsdGVyIGNvbXBhcmlzb24gZXN0aW1hdGVzLlxucHJvdG8uX2VzdGltYXRlID0gZnVuY3Rpb24oYmYsIGtlcm5lbCkge1xuICBpZiAoYmYuX3cgIT09IHRoaXMuX3cpIHRocm93ICdGaWx0ZXIgd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAoYmYuX2QgIT09IHRoaXMuX2QpIHRocm93ICdGaWx0ZXIgZGVwdGhzIGRvIG5vdCBtYXRjaC4nO1xuXG4gIHZhciBhID0gdGhpcy5fYnVja2V0cyxcbiAgICAgIGIgPSBiZi5fYnVja2V0cyxcbiAgICAgIG4gPSBhLmxlbmd0aCxcbiAgICAgIHgsIHksIHosIGk7XG5cbiAgZm9yIChpPXg9eT16PTA7IGk8bjsgKytpKSB7XG4gICAgeCArPSBiaXRjb3VudChhW2ldKTtcbiAgICB5ICs9IGJpdGNvdW50KGJbaV0pO1xuICAgIHogKz0gYml0Y291bnQoYVtpXSB8IGJbaV0pO1xuICB9XG4gIHggPSBNYXRoLmxvZygxIC0geCAvIHRoaXMuX3cpO1xuICB5ID0gTWF0aC5sb2coMSAtIHkgLyB0aGlzLl93KTtcbiAgeiA9IE1hdGgubG9nKDEgLSB6IC8gdGhpcy5fdyk7XG4gIHJldHVybiBrZXJuZWwoeCwgeSwgeik7XG59O1xuXG4vLyBKYWNjYXJkIGNvLWVmZmljaWVudCBvZiB0d28gYmxvb20gZmlsdGVycy5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIHNpemUgYW5kIGhhc2ggY291bnQuXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5qYWNjYXJkID0gZnVuY3Rpb24oYmYpIHtcbiAgcmV0dXJuIHRoaXMuX2VzdGltYXRlKGJmLCBmdW5jdGlvbihhLCBiLCB1bmlvbikge1xuICAgIHJldHVybiB1bmlvbiA/IChhICsgYikgLyB1bmlvbiAtIDEgOiAwO1xuICB9KTtcbn07XG5cbi8vIFNldCBjb3ZlciBvdmVyIHRoZSBzbWFsbGVyIG9mIHR3byBibG9vbSBmaWx0ZXJzLlxuLy8gVGhlIGlucHV0IGZpbHRlciBtdXN0IGhhdmUgdGhlIHNhbWUgc2l6ZSBhbmQgaGFzaCBjb3VudC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmNvdmVyID0gZnVuY3Rpb24oYmYpIHtcbiAgcmV0dXJuIHRoaXMuX2VzdGltYXRlKGJmLCBmdW5jdGlvbihhLCBiLCB1bmlvbikge1xuICAgIHZhciBkZW5vbSA9IE1hdGgubWF4KGEsIGIpO1xuICAgIHJldHVybiBkZW5vbSA/IChhICsgYiAtIHVuaW9uKSAvIGRlbm9tIDogMDtcbiAgfSk7XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgZmlsdGVyLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgZGVwdGg6IHRoaXMuX2QsXG4gICAgYml0czogW10uc2xpY2UuY2FsbCh0aGlzLl9idWNrZXRzKVxuICB9O1xufTtcblxuLy8gaHR0cDovL2dyYXBoaWNzLnN0YW5mb3JkLmVkdS9+c2VhbmRlci9iaXRoYWNrcy5odG1sI0NvdW50Qml0c1NldFBhcmFsbGVsXG5mdW5jdGlvbiBiaXRjb3VudCh2KSB7XG4gIHYgLT0gKHYgPj4gMSkgJiAweDU1NTU1NTU1O1xuICB2ID0gKHYgJiAweDMzMzMzMzMzKSArICgodiA+PiAyKSAmIDB4MzMzMzMzMzMpO1xuICByZXR1cm4gKCh2ICsgKHYgPj4gNCkgJiAweEYwRjBGMEYpICogMHgxMDEwMTAxKSA+PiAyNDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBCbG9vbUZpbHRlcjsiLCIvLyBDb3VudC1NZWFuLU1pbiBza2V0Y2hlcyBleHRlbmQgQ291bnQtTWluIHdpdGggaW1wcm92ZWQgZXN0aW1hdGlvbi5cbi8vIFNlZSAnTmV3IEVzdGltYXRpb24gQWxnb3JpdGhtcyBmb3IgU3RyZWFtaW5nIERhdGE6IENvdW50LW1pbiBDYW4gRG8gTW9yZSdcbi8vIGJ5IERlbmcgJiBSYWZpZWksIGh0dHA6Ly93ZWJkb2NzLmNzLnVhbGJlcnRhLmNhL35mYW5kZW5nL3BhcGVyL2NtbS5wZGZcblxudmFyIENvdW50TWluID0gcmVxdWlyZSgnLi9jb3VudC1taW4nKTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1lYW4tTWluIHNrZXRjaC5cbi8vIElmIGFyZ3VtZW50ICp3KiBpcyBhbiBhcnJheS1saWtlIG9iamVjdCwgd2l0aCBhIGxlbmd0aCBwcm9wZXJ0eSwgdGhlbiB0aGVcbi8vIHNrZXRjaCBpcyBsb2FkZWQgd2l0aCBkYXRhIGZyb20gdGhlIGFycmF5LCBlYWNoIGVsZW1lbnQgaXMgYSAzMi1iaXQgaW50ZWdlci5cbi8vIE90aGVyd2lzZSwgKncqIHNwZWNpZmllcyB0aGUgd2lkdGggKG51bWJlciBvZiByb3cgZW50cmllcykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpkKiBzcGVjaWZpZXMgdGhlIGRlcHRoIChudW1iZXIgb2YgaGFzaCBmdW5jdGlvbnMpIG9mIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqbnVtKiBpbmRpY2F0ZXMgdGhlIG51bWJlciBvZiBlbGVtZW50cyBhZGQuIFRoaXMgc2hvdWxkIG9ubHkgYmVcbi8vIHByb3ZpZGVkIGlmICp3KiBpcyBhbiBhcnJheSwgaW4gd2hpY2ggY2FzZSAqbnVtKiBpcyByZXF1aXJlZC5cbmZ1bmN0aW9uIENvdW50TWVhbk1pbih3LCBkLCBudW0pIHtcbiAgQ291bnRNaW4uY2FsbCh0aGlzLCB3LCBkLCBudW0pO1xuICB0aGlzLl9xID0gQXJyYXkoZCk7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGJhc2VkIG9uIHByb3ZpZGVkIHBlcmZvcm1hbmNlIHBhcmFtZXRlcnMuXG4vLyBBcmd1bWVudCAqbiogaXMgdGhlIGV4cGVjdGVkIGNvdW50IG9mIGFsbCBlbGVtZW50c1xuLy8gQXJndW1lbnQgKmUqIGlzIHRoZSBhY2NlcHRhYmxlIGFic29sdXRlIGVycm9yLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBwcm9iYWJpbGl0eSBvZiBub3QgYWNoaWV2aW5nIHRoZSBlcnJvciBib3VuZC5cbkNvdW50TWVhbk1pbi5jcmVhdGUgPSBDb3VudE1pbi5jcmVhdGU7XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NZWFuLU1pbiBza2V0Y2ggZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQ291bnRNZWFuTWluLmltcG9ydCA9IENvdW50TWluLmltcG9ydDtcblxudmFyIHByb3RvID0gKENvdW50TWVhbk1pbi5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKENvdW50TWluLnByb3RvdHlwZSkpO1xuXG4vLyBRdWVyeSBmb3IgYXBwcm94aW1hdGUgY291bnQuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgdCA9IHRoaXMuX3RhYmxlLFxuICAgICAgcSA9IHRoaXMuX3EsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLFxuICAgICAgbiA9IHRoaXMuX251bSxcbiAgICAgIHMgPSAxIC8gKHctMSksXG4gICAgICBtaW4gPSArSW5maW5pdHksIGMsIGksIHI7XG5cbiAgZm9yIChpPTAsIHI9MDsgaTxkOyArK2ksIHIrPXcpIHtcbiAgICBjID0gdFtyICsgbFtpXV07XG4gICAgaWYgKGMgPCBtaW4pIG1pbiA9IGM7XG4gICAgYyA9IGMgLSAobi1jKSAqIHM7XG4gICAgcVtpXSA9IGM7XG4gIH1cblxuICByZXR1cm4gKGMgPSBtZWRpYW4ocSkpIDwgMCA/IDAgOiBjID4gbWluID8gbWluIDogYztcbn07XG5cbi8vIEFwcHJveGltYXRlIGRvdCBwcm9kdWN0IHdpdGggYW5vdGhlciBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIG11c3QgaGF2ZSB0aGUgc2FtZSBkZXB0aCBhbmQgd2lkdGguXG4vLyBPdGhlcndpc2UsIHRoaXMgbWV0aG9kIHdpbGwgdGhyb3cgYW4gZXJyb3IuXG5wcm90by5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gIGlmICh0aGlzLl93ICE9PSB0aGF0Ll93KSB0aHJvdyAnU2tldGNoIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKHRoaXMuX2QgIT09IHRoYXQuX2QpIHRocm93ICdTa2V0Y2ggZGVwdGhzIGRvIG5vdCBtYXRjaC4nO1xuXG4gIHZhciB0YSA9IHRoaXMuX3RhYmxlLFxuICAgICAgdGIgPSB0aGF0Ll90YWJsZSxcbiAgICAgIHEgPSB0aGlzLl9xLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBuID0gdGhpcy5fbnVtLFxuICAgICAgbSA9IHRoaXMuX2QgKiB3LFxuICAgICAgeiA9ICh3IC0gMSkgLyB3LFxuICAgICAgcyA9IDEgLyAody0xKSxcbiAgICAgIGRvdCA9IDAsIGkgPSAwO1xuXG4gIGRvIHtcbiAgICBkb3QgKz0gKHRhW2ldIC0gKG4tdGFbaV0pKnMpICogKHRiW2ldIC0gKG4tdGJbaV0pKnMpO1xuICAgIGlmICgrK2kgJSB3ID09PSAwKSB7XG4gICAgICBxW2kvdy0xXSA9IHogKiBkb3Q7XG4gICAgICBkb3QgPSAwO1xuICAgIH1cbiAgfSB3aGlsZSAoaSA8IG0pO1xuXG4gIHJldHVybiAoZG90ID0gbWVkaWFuKHEpKSA8IDAgPyAwIDogZG90O1xufTtcblxuZnVuY3Rpb24gbWVkaWFuKHEpIHtcbiAgcS5zb3J0KG51bWNtcCk7XG4gIHZhciBuID0gcS5sZW5ndGgsXG4gICAgICBoID0gfn4obi8yKTtcbiAgcmV0dXJuIG4gJSAyID8gcVtoXSA6IDAuNSAqIChxW2gtMV0gKyBxW2hdKTtcbn1cblxuZnVuY3Rpb24gbnVtY21wKGEsIGIpIHtcbiAgcmV0dXJuIGEgLSBiO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IENvdW50TWVhbk1pbjtcbiIsInZhciBoYXNoID0gcmVxdWlyZSgnLi9oYXNoJyk7XG5cbnZhciBUWVBFRF9BUlJBWVMgPSB0eXBlb2YgQXJyYXlCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIsXG4gICAgREVGQVVMVF9CSU5TID0gMjcxOTEsXG4gICAgREVGQVVMVF9IQVNIID0gOTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggZm9yIGFwcHJveGltYXRlIGNvdW50cyBvZiB2YWx1ZSBmcmVxdWVuY2llcy5cbi8vIFNlZTogJ0FuIEltcHJvdmVkIERhdGEgU3RyZWFtIFN1bW1hcnk6IFRoZSBDb3VudC1NaW4gU2tldGNoIGFuZCBpdHNcbi8vIEFwcGxpY2F0aW9ucycgYnkgRy4gQ29ybW9kZSAmIFMuIE11dGh1a3Jpc2huYW4uXG4vLyBJZiBhcmd1bWVudCAqdyogaXMgYW4gYXJyYXktbGlrZSBvYmplY3QsIHdpdGggYSBsZW5ndGggcHJvcGVydHksIHRoZW4gdGhlXG4vLyBza2V0Y2ggaXMgbG9hZGVkIHdpdGggZGF0YSBmcm9tIHRoZSBhcnJheSwgZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuXG4vLyBPdGhlcndpc2UsICp3KiBzcGVjaWZpZXMgdGhlIHdpZHRoIChudW1iZXIgb2Ygcm93IGVudHJpZXMpIG9mIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqZCogc3BlY2lmaWVzIHRoZSBkZXB0aCAobnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKm51bSogaW5kaWNhdGVzIHRoZSBudW1iZXIgb2YgZWxlbWVudHMgYWRkLiBUaGlzIHNob3VsZCBvbmx5IGJlXG4vLyBwcm92aWRlZCBpZiAqdyogaXMgYW4gYXJyYXksIGluIHdoaWNoIGNhc2UgKm51bSogaXMgcmVxdWlyZWQuXG5mdW5jdGlvbiBDb3VudE1pbih3LCBkLCBudW0pIHtcbiAgdyA9IHcgfHwgREVGQVVMVF9CSU5TO1xuICBkID0gZCB8fCBERUZBVUxUX0hBU0g7XG5cbiAgdmFyIGEsIHQsIGk9LTEsIG47XG4gIGlmICh0eXBlb2YgdyAhPT0gXCJudW1iZXJcIikgeyBhID0gdzsgdyA9IGEubGVuZ3RoIC8gZDsgfVxuICB0aGlzLl93ID0gdztcbiAgdGhpcy5fZCA9IGQ7XG4gIHRoaXMuX251bSA9IG51bSB8fCAwO1xuICBuID0gdyAqIGQ7XG5cbiAgaWYgKFRZUEVEX0FSUkFZUykge1xuICAgIHQgPSB0aGlzLl90YWJsZSA9IG5ldyBJbnQzMkFycmF5KG4pO1xuICAgIGlmIChhKSB3aGlsZSAoKytpIDwgbikgdFtpXSA9IGFbaV07XG4gIH0gZWxzZSB7XG4gICAgdCA9IHRoaXMuX3RhYmxlID0gQXJyYXkobik7XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSB0W2ldID0gYVtpXTtcbiAgICB3aGlsZSAoKytpIDwgbikgdFtpXSA9IDA7XG4gIH1cbiAgaGFzaC5pbml0LmNhbGwodGhpcyk7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGJhc2VkIG9uIHByb3ZpZGVkIHBlcmZvcm1hbmNlIHBhcmFtZXRlcnMuXG4vLyBBcmd1bWVudCAqbiogaXMgdGhlIGV4cGVjdGVkIGNvdW50IG9mIGFsbCBlbGVtZW50c1xuLy8gQXJndW1lbnQgKmUqIGlzIHRoZSBhY2NlcHRhYmxlIGFic29sdXRlIGVycm9yLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBwcm9iYWJpbGl0eSBvZiBub3QgYWNoaWV2aW5nIHRoZSBlcnJvciBib3VuZC5cbi8vIGh0dHA6Ly9kaW1hY3MucnV0Z2Vycy5lZHUvfmdyYWhhbS9wdWJzL3BhcGVycy9jbWVuY3ljLnBkZlxuQ291bnRNaW4uY3JlYXRlID0gZnVuY3Rpb24obiwgZSwgcCkge1xuICBlID0gbiA/IChlID8gZS9uIDogMS9uKSA6IDAuMDAxO1xuICBwID0gcCB8fCAwLjAwMTtcbiAgdmFyIHcgPSBNYXRoLmNlaWwoTWF0aC5FIC8gZSksXG4gICAgICBkID0gTWF0aC5jZWlsKC1NYXRoLmxvZyhwKSk7XG4gIHJldHVybiBuZXcgdGhpcyh3LCBkKTtcbn07XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdC5cbkNvdW50TWluLmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICByZXR1cm4gbmV3IHRoaXMob2JqLmNvdW50cywgb2JqLmRlcHRoLCBvYmoubnVtKTtcbn07XG5cbnZhciBwcm90byA9IENvdW50TWluLnByb3RvdHlwZTtcblxucHJvdG8ubG9jYXRpb25zID0gaGFzaC5sb2NhdGlvbnM7XG5cbi8vIEFkZCBhIHZhbHVlIHRvIHRoZSBza2V0Y2guXG5wcm90by5hZGQgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModiArICcnKSxcbiAgICAgIHQgPSB0aGlzLl90YWJsZSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsIGksIHI7XG4gIGZvciAoaT0wLCByPTA7IGk8ZDsgKytpLCByKz13KSB7XG4gICAgdFtyICsgbFtpXV0gKz0gMTtcbiAgfVxuICB0aGlzLl9udW0gKz0gMTtcbn07XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odikge1xuICB2YXIgbWluID0gK0luZmluaXR5LFxuICAgICAgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLCBpLCByLCBjO1xuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIGMgPSB0W3IgKyBsW2ldXTtcbiAgICBpZiAoYyA8IG1pbikgbWluID0gYztcbiAgfVxuICByZXR1cm4gbWluO1xufTtcblxuLy8gQXBwcm94aW1hdGUgZG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgaWYgKHRoaXMuX3cgIT09IHRoYXQuX3cpIHRocm93ICdTa2V0Y2ggd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAodGhpcy5fZCAhPT0gdGhhdC5fZCkgdGhyb3cgJ1NrZXRjaCBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIHRhID0gdGhpcy5fdGFibGUsXG4gICAgICB0YiA9IHRoYXQuX3RhYmxlLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBtID0gdGhpcy5fZCAqIHcsXG4gICAgICBtaW4gPSArSW5maW5pdHksXG4gICAgICBkb3QgPSAwLCBpID0gMDtcblxuICBkbyB7XG4gICAgZG90ICs9IHRhW2ldICogdGJbaV07XG4gICAgaWYgKCsraSAlIHcgPT09IDApIHtcbiAgICAgIGlmIChkb3QgPCBtaW4pIG1pbiA9IGRvdDtcbiAgICAgIGRvdCA9IDA7XG4gICAgfVxuICB9IHdoaWxlIChpIDwgbSk7XG5cbiAgcmV0dXJuIG1pbjtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBza2V0Y2guXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICBudW06IHRoaXMuX251bSxcbiAgICBkZXB0aDogdGhpcy5fZCxcbiAgICBjb3VudHM6IFtdLnNsaWNlLmNhbGwodGhpcy5fdGFibGUpXG4gIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvdW50TWluO1xuIiwidmFyIFRZUEVEX0FSUkFZUyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIjtcblxuLy8gRm93bGVyL05vbGwvVm8gaGFzaGluZy5cbmZ1bmN0aW9uIGZudl8xYSh2KSB7XG4gIHZhciBuID0gdi5sZW5ndGgsXG4gICAgICBhID0gMjE2NjEzNjI2MSxcbiAgICAgIGMsXG4gICAgICBkLFxuICAgICAgaSA9IC0xO1xuICB3aGlsZSAoKytpIDwgbikge1xuICAgIGMgPSB2LmNoYXJDb2RlQXQoaSk7XG4gICAgaWYgKChkID0gYyAmIDB4ZmYwMDAwMDApKSB7XG4gICAgICBhIF49IGQgPj4gMjQ7XG4gICAgICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICAgIH1cbiAgICBpZiAoKGQgPSBjICYgMHhmZjAwMDApKSB7XG4gICAgICBhIF49IGQgPj4gMTY7XG4gICAgICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICAgIH1cbiAgICBpZiAoKGQgPSBjICYgMHhmZjAwKSkge1xuICAgICAgYSBePSBkID4+IDg7XG4gICAgICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICAgIH1cbiAgICBhIF49IGMgJiAweGZmO1xuICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gIH1cbiAgLy8gRnJvbSBodHRwOi8vaG9tZS5jb21jYXN0Lm5ldC9+YnJldG0vaGFzaC82Lmh0bWxcbiAgYSArPSBhIDw8IDEzO1xuICBhIF49IGEgPj4gNztcbiAgYSArPSBhIDw8IDM7XG4gIGEgXj0gYSA+PiAxNztcbiAgYSArPSBhIDw8IDU7XG4gIHJldHVybiBhICYgMHhmZmZmZmZmZjtcbn1cblxuLy8gT25lIGFkZGl0aW9uYWwgaXRlcmF0aW9uIG9mIEZOViwgZ2l2ZW4gYSBoYXNoLlxuZnVuY3Rpb24gZm52XzFhX2IoYSkge1xuICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICBhICs9IGEgPDwgMTM7XG4gIGEgXj0gYSA+PiA3O1xuICBhICs9IGEgPDwgMztcbiAgYSBePSBhID4+IDE3O1xuICBhICs9IGEgPDwgNTtcbiAgcmV0dXJuIGEgJiAweGZmZmZmZmZmO1xufVxuXG4vLyBtaXgtaW4gbWV0aG9kIGZvciBtdWx0aS1oYXNoIGluaXRpYWxpemF0aW9uXG5tb2R1bGUuZXhwb3J0cy5pbml0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBkID0gdGhpcy5fZCxcbiAgICAgIHcgPSB0aGlzLl93O1xuXG4gIGlmIChUWVBFRF9BUlJBWVMpIHtcbiAgICB2YXIga2J5dGVzID0gMSA8PCBNYXRoLmNlaWwoTWF0aC5sb2coXG4gICAgICAgICAgTWF0aC5jZWlsKE1hdGgubG9nKHcpIC8gTWF0aC5MTjIgLyA4KVxuICAgICAgICApIC8gTWF0aC5MTjIpLFxuICAgICAgICBhcnJheSA9IGtieXRlcyA9PT0gMSA/IFVpbnQ4QXJyYXkgOiBrYnl0ZXMgPT09IDIgPyBVaW50MTZBcnJheSA6IFVpbnQzMkFycmF5LFxuICAgICAgICBrYnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKGtieXRlcyAqIGQpO1xuICAgIHRoaXMuX2xvY2F0aW9ucyA9IG5ldyBhcnJheShrYnVmZmVyKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLl9sb2NhdGlvbnMgPSBbXTtcbiAgfVxufTtcblxuLy8gbWl4LWluIG1ldGhvZCBmb3IgbXVsdGktaGFzaCBjYWxjdWxhdGlvblxuLy8gU2VlIGh0dHA6Ly93aWxsd2hpbS53b3JkcHJlc3MuY29tLzIwMTEvMDkvMDMvcHJvZHVjaW5nLW4taGFzaC1mdW5jdGlvbnMtYnktaGFzaGluZy1vbmx5LW9uY2UvXG5tb2R1bGUuZXhwb3J0cy5sb2NhdGlvbnMgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBkID0gdGhpcy5fZCxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgciA9IHRoaXMuX2xvY2F0aW9ucyxcbiAgICAgIGEgPSBmbnZfMWEodiksXG4gICAgICBiID0gZm52XzFhX2IoYSksXG4gICAgICBpID0gLTEsXG4gICAgICB4ID0gYSAlIHc7XG4gIHdoaWxlICgrK2kgPCBkKSB7XG4gICAgcltpXSA9IHggPCAwID8gKHggKyB3KSA6IHg7XG4gICAgeCA9ICh4ICsgYikgJSB3O1xuICB9XG4gIHJldHVybiByO1xufTtcblxubW9kdWxlLmV4cG9ydHMuZm52XzFhID0gZm52XzFhO1xubW9kdWxlLmV4cG9ydHMuZm52XzFhX2IgPSBmbnZfMWFfYjtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1xuICBCbG9vbTogICAgICAgICByZXF1aXJlKCcuL2Jsb29tJyksXG4gIENvdW50TWluOiAgICAgIHJlcXVpcmUoJy4vY291bnQtbWluJyksXG4gIENvdW50TWVhbk1pbjogIHJlcXVpcmUoJy4vY291bnQtbWVhbi1taW4nKSxcbiAgTkdyYW06ICAgICAgICAgcmVxdWlyZSgnLi9uZ3JhbScpLFxuICBTdHJlYW1TdW1tYXJ5OiByZXF1aXJlKCcuL3N0cmVhbS1zdW1tYXJ5Jylcbn07IiwiLy8gQ3JlYXRlIGEgbmV3IGNoYXJhY3Rlci1sZXZlbCBuLWdyYW0gc2tldGNoLlxuLy8gKm4qIGlzIHRoZSBudW1iZXIgb2YgY2hhcmFjdGVycyB0byBpbmNsdWRlLCBkZWZhdWx0cyB0byAyLlxuLy8gKmNhc2VTZW5zaXRpdmUqIGluZGljYXRlcyBjYXNlLXNlbnNpdGl2aXR5LCBkZWZhdWx0cyB0byBmYWxzZS5cbi8vICptYXAqIGlzIGFuIG9wdGlvbmFsIGV4aXN0aW5nIG5ncmFtIHRvIGNvdW50IG1hcC5cbmZ1bmN0aW9uIE5HcmFtKG4sIGNhc2VTZW5zaXRpdmUsIG1hcCkge1xuICB0aGlzLl9uID0gbiA9PSBudWxsID8gMiA6IG47XG4gIHRoaXMuX2Nhc2UgPSAhIWNhc2VTZW5zaXRpdmU7XG4gIHRoaXMuX21hcCA9IG1hcCB8fCB7fTtcbiAgdGhpcy5fbm9ybSA9IG51bGw7XG59XG5cbk5HcmFtLmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICByZXR1cm4gbmV3IE5HcmFtKG9iai5uLCBvYmouY2FzZSwgb2JqLmNvdW50cyk7XG59O1xuXG52YXIgcHJvdG8gPSBOR3JhbS5wcm90b3R5cGU7XG5cbi8vIEFkZCBhbGwgY29uc2VjdXRpdmUgbi1ncmFtcyBpbiAqcyogdG8gdGhpcyBza2V0Y2hcbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKHMgPT0gbnVsbCB8fCBzID09PSAnJykgcmV0dXJuO1xuICB0aGlzLl9ub3JtID0gbnVsbDtcbiAgY291bnRzKFN0cmluZyhzKSwgdGhpcy5fbiwgdGhpcy5fY2FzZSwgdGhpcy5fbWFwKTtcbn07XG5cbi8vIGFkZCBjb3VudHMgb2Ygbi1ncmFtcyBpbiBzdHJpbmcgdG8gYSBtYXBcbmZ1bmN0aW9uIGNvdW50cyhzLCBuLCBjLCBtYXApIHtcbiAgdmFyIGxlbiA9IHMubGVuZ3RoIC0gbiArIDEsXG4gICAgICBrLCBpO1xuICBcbiAgZm9yIChpPTA7IGk8bGVuOyArK2kpIHtcbiAgICBrID0gcy5zdWJzdHIoaSwgbik7XG4gICAgaWYgKCFjKSBrID0gay50b0xvd2VyQ2FzZSgpO1xuICAgIG1hcFtrXSA9IG1hcFtrXSA/IG1hcFtrXSArIDEgOiAxO1xuICB9XG59XG5cbi8vIFRoZSBvY2N1cnJlbmNlIGNvdW50IG9mIGEgZ2l2ZW4gbi1ncmFtLlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbihrZXkpIHtcbiAgcmV0dXJuIHRoaXMuX21hcFt0aGlzLl9jYXNlID8ga2V5IDoga2V5LnRvTG93ZXJDYXNlKCldIHx8IDA7XG59O1xuXG4vLyBSZXR1cm4gdGhlIG51bWJlciBvZiB1bmlxdWUgbi1ncmFtcyBvYnNlcnZlZC5cbnByb3RvLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuX21hcCkubGVuZ3RoO1xufTtcblxuLy8gUmV0dXJuIHRoZSB2ZWN0b3Igbm9ybSBvZiB0aGUgY291bnRzIGluIHRoaXMgc2tldGNoLlxucHJvdG8ubm9ybSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5fbm9ybSA9PSBudWxsKSB7XG4gICAgdmFyIG0gPSB0aGlzLl9tYXAsXG4gICAgICAgIHMgPSAwLCBrO1xuICAgIGZvciAoayBpbiBtKSB7XG4gICAgICBzICs9IG1ba10gKiBtW2tdO1xuICAgIH1cbiAgICB0aGlzLl9ub3JtID0gTWF0aC5zcXJ0KHMpO1xuICB9XG4gIHJldHVybiB0aGlzLl9ub3JtO1xufTtcblxuLy8gRG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIG4tZ3JhbSBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIHNob3VsZCBoYXZlIHRoZSBzYW1lICpuKiBwYXJhbWV0ZXIuXG5wcm90by5kb3QgPSBmdW5jdGlvbih0aGF0KSB7XG4gIHZhciBhID0gdGhpcy5fbWFwLFxuICAgICAgYiA9IHRoYXQuX21hcCxcbiAgICAgIGRvdCA9IDAsIGs7XG5cbiAgZm9yIChrIGluIGEpIHtcbiAgICBkb3QgKz0gYVtrXSAqIChiW2tdIHx8IDApO1xuICB9XG4gIFxuICByZXR1cm4gZG90O1xufTtcblxuLy8gQ29zaW5lIHNpbWlsYXJpdHkgd2l0aCBhbm90aGVyIG4tZ3JhbSBza2V0Y2guXG4vLyBUaGUgaW5wdXQgc2tldGNoIHNob3VsZCBoYXZlIHRoZSBzYW1lICpuKiBwYXJhbWV0ZXIuXG5wcm90by5jb3NpbmUgPSBmdW5jdGlvbih0aGF0KSB7XG4gIHZhciBhYSA9IHRoaXMubm9ybSgpLFxuICAgICAgYmIgPSB0aGF0Lm5vcm0oKTtcbiAgcmV0dXJuIChhYSAmJiBiYikgPyB0aGlzLmRvdCh0aGF0KSAvIChhYSAqIGJiKSA6IDA7XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgc2tldGNoLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgbjogdGhpcy5fbixcbiAgICBjYXNlOiB0aGlzLl9jYXNlLFxuICAgIGNvdW50czogdGhpcy5fbWFwXG4gIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE5HcmFtO1xuIiwidmFyIERFRkFVTFRfQ09VTlRFUlMgPSAxMDA7XG5cbi8vIENyZWF0ZSBhIG5ldyBzdHJlYW0gc3VtbWFyeSBza2V0Y2ggZm9yIHRyYWNraW5nIGZyZXF1ZW50IHZhbHVlcy5cbi8vIFNlZTogJ0VmZmljaWVudCBDb21wdXRhdGlvbiBvZiBGcmVxdWVudCBhbmQgVG9wLWsgRWxlbWVudHMgaW4gRGF0YSBTdHJlYW1zJ1xuLy8gYnkgQS4gTWV0d2FsbHksIEQuIEFncmF3YWwgJiBBLiBFbCBBYmJhZGkuXG4vLyBBcmd1bWVudCAqdyogc3BlY2lmaWVzIHRoZSBtYXhpbXVtIG51bWJlciBvZiBhY3RpdmUgY291bnRlcnMgdG8gbWFpbnRhaW4uXG4vLyBJZiBub3QgcHJvdmlkZWQsICp3KiBkZWZhdWx0cyB0byB0cmFja2luZyBhIG1heGltdW0gb2YgMTAwIHZhbHVlcy5cbmZ1bmN0aW9uIFN0cmVhbVN1bW1hcnkodykge1xuICB0aGlzLl93ID0gdyB8fCBERUZBVUxUX0NPVU5URVJTO1xuICB0aGlzLl92YWx1ZXMgPSB7fTtcblxuICB0aGlzLl9idWNrZXRzID0ge2NvdW50OiAtMX07XG4gIHRoaXMuX2J1Y2tldHMubmV4dCA9IHRoaXMuX2J1Y2tldHM7XG4gIHRoaXMuX2J1Y2tldHMucHJldiA9IHRoaXMuX2J1Y2tldHM7XG5cbiAgdGhpcy5fc2l6ZSA9IDA7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBTdHJlYW1TdW1tYXJ5IHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5TdHJlYW1TdW1tYXJ5LmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICB2YXIgc3MgPSBuZXcgU3RyZWFtU3VtbWFyeShvYmoudyksXG4gICAgICBiYiA9IHNzLl9idWNrZXRzLFxuICAgICAgaSwgbiwgYywgYiwgaiwgbSwgZTtcblxuICBmb3IgKGk9MCwgbj1vYmouYnVja2V0cy5sZW5ndGg7IGk8bjsgKytpKSB7XG4gICAgYyA9IG9iai5idWNrZXRzW2ldO1xuICAgIGIgPSBpbnNlcnQoYmIucHJldiwgYnVja2V0KGNbMF0pKTtcbiAgICBmb3IgKGo9MSwgbT1jLmxlbmd0aDsgajxtOyBqKz0yKSB7XG4gICAgICBlID0gaW5zZXJ0KGIubGlzdC5wcmV2LCBlbnRyeShjW2pdLCBiKSk7XG4gICAgICBlLmNvdW50ID0gYi5jb3VudDtcbiAgICAgIGUuZXJyb3IgPSBjW2orMV07XG4gICAgICBzcy5fc2l6ZSArPSAxO1xuICAgIH1cbiAgfVxuICBcbiAgcmV0dXJuIHNzO1xufTtcblxuLy8gR2VuZXJhdGUgYSBuZXcgZnJlcXVlbmN5IGJ1Y2tldC5cbmZ1bmN0aW9uIGJ1Y2tldChjb3VudCkge1xuICB2YXIgYiA9IHtjb3VudDogY291bnR9O1xuICBiLm5leHQgPSBiO1xuICBiLnByZXYgPSBiO1xuICBiLmxpc3QgPSB7fTtcbiAgYi5saXN0LnByZXYgPSBiLmxpc3Q7XG4gIGIubGlzdC5uZXh0ID0gYi5saXN0O1xuICByZXR1cm4gYjtcbn1cblxuLy8gR2VuZXJhdGUgYSBuZXcgY291bnRlciBub2RlIGZvciBhIHZhbHVlLlxuZnVuY3Rpb24gZW50cnkodmFsdWUsIGJ1Y2tldCkge1xuICByZXR1cm4ge1xuICAgIGJ1Y2tldDogYnVja2V0LFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgICBjb3VudDogMCxcbiAgICBlcnJvcjogMFxuICB9O1xufVxuXG4vLyBJbnNlcnQgKmN1cnIqIGFoZWFkIG9mIGxpbmtlZCBsaXN0IG5vZGUgKmxpc3QqLlxuZnVuY3Rpb24gaW5zZXJ0KGxpc3QsIGN1cnIpIHtcbiAgdmFyIG5leHQgPSBsaXN0Lm5leHQ7XG4gIGN1cnIubmV4dCA9IG5leHQ7XG4gIGN1cnIucHJldiA9IGxpc3Q7XG4gIGxpc3QubmV4dCA9IGN1cnI7XG4gIG5leHQucHJldiA9IGN1cnI7XG4gIHJldHVybiBjdXJyO1xufVxuXG4vLyBEZXRhY2ggKmN1cnIqIGZyb20gaXRzIGxpbmtlZCBsaXN0LlxuZnVuY3Rpb24gZGV0YWNoKGN1cnIpIHtcbiAgdmFyIG4gPSBjdXJyLm5leHQsXG4gICAgICBwID0gY3Vyci5wcmV2O1xuICBwLm5leHQgPSBuO1xuICBuLnByZXYgPSBwO1xufVxuXG52YXIgcHJvdG8gPSBTdHJlYW1TdW1tYXJ5LnByb3RvdHlwZTtcblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICp2KiBpcyB0aGUgdmFsdWUgdG8gYWRkLlxuLy8gQXJndW1lbnQgKmNvdW50KiBpcyB0aGUgb3B0aW9uYWwgbnVtYmVyIG9mIG9jY3VycmVuY2VzIHRvIHJlZ2lzdGVyLlxuLy8gSWYgKmNvdW50KiBpcyBub3QgcHJvdmlkZWQsIGFuIGluY3JlbWVudCBvZiAxIGlzIGFzc3VtZWQuXG5wcm90by5hZGQgPSBmdW5jdGlvbih2LCBjb3VudCkge1xuICBjb3VudCA9IGNvdW50IHx8IDE7XG4gIHZhciBub2RlID0gdGhpcy5fdmFsdWVzW3ZdLCBiO1xuXG4gIGlmIChub2RlID09IG51bGwpIHtcbiAgICBpZiAodGhpcy5fc2l6ZSA8IHRoaXMuX3cpIHtcbiAgICAgIGIgPSBpbnNlcnQodGhpcy5fYnVja2V0cywgYnVja2V0KDApKTtcbiAgICAgIG5vZGUgPSBpbnNlcnQoYi5saXN0LCBlbnRyeSh2LCBiKSk7XG4gICAgICB0aGlzLl9zaXplICs9IDE7XG4gICAgfSBlbHNlIHtcbiAgICAgIGIgPSB0aGlzLl9idWNrZXRzLm5leHQ7XG4gICAgICBub2RlID0gYi5saXN0Lm5leHQ7XG4gICAgICBkZWxldGUgdGhpcy5fdmFsdWVzW25vZGUudmFsdWVdO1xuICAgICAgbm9kZS52YWx1ZSA9IHY7XG4gICAgICBub2RlLmVycm9yID0gYi5jb3VudDtcbiAgICB9XG4gICAgdGhpcy5fdmFsdWVzW3ZdID0gbm9kZTsgICAgXG4gIH1cbiAgdGhpcy5faW5jcmVtZW50KG5vZGUsIGNvdW50KTtcbn07XG5cbi8vIEluY3JlbWVudCB0aGUgY291bnQgaW4gdGhlIHN0cmVhbSBzdW1tYXJ5IGRhdGEgc3RydWN0dXJlLlxucHJvdG8uX2luY3JlbWVudCA9IGZ1bmN0aW9uKG5vZGUsIGNvdW50KSB7XG4gIHZhciBoZWFkID0gdGhpcy5fYnVja2V0cyxcbiAgICAgIG9sZCAgPSBub2RlLmJ1Y2tldCxcbiAgICAgIHByZXYgPSBvbGQsXG4gICAgICBuZXh0ID0gcHJldi5uZXh0O1xuXG4gIGRldGFjaChub2RlKTtcbiAgbm9kZS5jb3VudCArPSBjb3VudDtcblxuICB3aGlsZSAobmV4dCAhPT0gaGVhZCkge1xuICAgIGlmIChub2RlLmNvdW50ID09PSBuZXh0LmNvdW50KSB7XG4gICAgICBpbnNlcnQobmV4dC5saXN0LCBub2RlKTtcbiAgICAgIGJyZWFrO1xuICAgIH0gZWxzZSBpZiAobm9kZS5jb3VudCA+IG5leHQuY291bnQpIHtcbiAgICAgIHByZXYgPSBuZXh0O1xuICAgICAgbmV4dCA9IHByZXYubmV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV4dCA9IGhlYWQ7XG4gICAgfVxuICB9XG5cbiAgaWYgKG5leHQgPT09IGhlYWQpIHtcbiAgICBuZXh0ID0gYnVja2V0KG5vZGUuY291bnQpO1xuICAgIGluc2VydChuZXh0Lmxpc3QsIG5vZGUpOyAvLyBhZGQgdmFsdWUgbm9kZSB0byBidWNrZXRcbiAgICBpbnNlcnQocHJldiwgbmV4dCk7ICAvLyBhZGQgYnVja2V0IHRvIGJ1Y2tldCBsaXN0XG4gIH1cbiAgbm9kZS5idWNrZXQgPSBuZXh0O1xuXG4gIC8vIGNsZWFuIHVwIGlmIG9sZCBidWNrZXQgaXMgZW1wdHlcbiAgaWYgKG9sZC5saXN0Lm5leHQgPT09IG9sZC5saXN0KSB7XG4gICAgZGV0YWNoKG9sZCk7XG4gIH1cbn07XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudCBmb3IgdmFsdWUgKnYqLlxuLy8gUmV0dXJucyB6ZXJvIGlmICp2KiBpcyBub3QgaW4gdGhlIHNrZXRjaC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odikge1xuICB2YXIgbm9kZSA9IHRoaXMuX3ZhbHVlc1t2XTtcbiAgcmV0dXJuIG5vZGUgPyBub2RlLmNvdW50IDogMDtcbn07XG5cbi8vIFF1ZXJ5IGZvciBlc3RpbWF0aW9uIGVycm9yIGZvciB2YWx1ZSAqdiouXG4vLyBSZXR1cm5zIC0xIGlmICp2KiBpcyBub3QgaW4gdGhlIHNrZXRjaC5cbnByb3RvLmVycm9yID0gZnVuY3Rpb24odikge1xuICB2YXIgbm9kZSA9IHRoaXMuX3ZhbHVlc1t2XTtcbiAgcmV0dXJuIG5vZGUgPyBub2RlLmVycm9yIDogLTE7XG59O1xuXG4vLyBSZXR1cm5zIHRoZSAoYXBwcm94aW1hdGUpIHRvcC1rIG1vc3QgZnJlcXVlbnQgdmFsdWVzLFxuLy8gcmV0dXJuZWQgaW4gb3JkZXIgb2YgZGVjcmVhc2luZyBmcmVxdWVuY3kuXG4vLyBBbGwgbW9uaXRvcmVkIHZhbHVlcyBhcmUgcmV0dXJuZWQgaWYgKmsqIGlzIG5vdCBwcm92aWRlZFxuLy8gb3IgaXMgbGFyZ2VyIHRoYW4gdGhlIHNrZXRjaCBzaXplLlxucHJvdG8udmFsdWVzID0gZnVuY3Rpb24oaykge1xuICByZXR1cm4gdGhpcy5jb2xsZWN0KGssIGZ1bmN0aW9uKHgpIHsgcmV0dXJuIHgudmFsdWU7IH0pO1xufTtcblxuLy8gUmV0dXJucyBjb3VudHMgZm9yIHRoZSAoYXBwcm94aW1hdGUpIHRvcC1rIGZyZXF1ZW50IHZhbHVlcyxcbi8vIHJldHVybmVkIGluIG9yZGVyIG9mIGRlY3JlYXNpbmcgZnJlcXVlbmN5LlxuLy8gQWxsIG1vbml0b3JlZCBjb3VudHMgYXJlIHJldHVybmVkIGlmICprKiBpcyBub3QgcHJvdmlkZWRcbi8vIG9yIGlzIGxhcmdlciB0aGFuIHRoZSBza2V0Y2ggc2l6ZS5cbnByb3RvLmNvdW50cyA9IGZ1bmN0aW9uKGspIHtcbiAgcmV0dXJuIHRoaXMuY29sbGVjdChrLCBmdW5jdGlvbih4KSB7IHJldHVybiB4LmNvdW50OyB9KTtcbn07XG5cbi8vIFJldHVybnMgZXN0aW1hdGlvbiBlcnJvciB2YWx1ZXMgZm9yIHRoZSAoYXBwcm94aW1hdGUpIHRvcC1rXG4vLyBmcmVxdWVudCB2YWx1ZXMsIHJldHVybmVkIGluIG9yZGVyIG9mIGRlY3JlYXNpbmcgZnJlcXVlbmN5LlxuLy8gQWxsIG1vbml0b3JlZCBjb3VudHMgYXJlIHJldHVybmVkIGlmICprKiBpcyBub3QgcHJvdmlkZWRcbi8vIG9yIGlzIGxhcmdlciB0aGFuIHRoZSBza2V0Y2ggc2l6ZS5cbnByb3RvLmVycm9ycyA9IGZ1bmN0aW9uKGspIHtcbiAgcmV0dXJuIHRoaXMuY29sbGVjdChrLCBmdW5jdGlvbih4KSB7IHJldHVybiB4LmVycm9yOyB9KTtcbn07XG5cbi8vIENvbGxlY3RzIHZhbHVlcyBmb3IgZWFjaCBlbnRyeSBpbiB0aGUgc2tldGNoLCBpbiBvcmRlciBvZlxuLy8gZGVjcmVhc2luZyAoYXBwcm94aW1hdGUpIGZyZXF1ZW5jeS5cbi8vIEFyZ3VtZW50ICprKiBpcyB0aGUgbnVtYmVyIG9mIHZhbHVlcyB0byBjb2xsZWN0LiBJZiB0aGUgKmsqIGlzIG5vdFxuLy8gcHJvdmlkZWQgb3IgZ3JlYXRlciB0aGFuIHRoZSBza2V0Y2ggc2l6ZSwgYWxsIHZhbHVlcyBhcmUgdmlzaXRlZC5cbi8vIEFyZ3VtZW50ICpmKiBpcyBhbiBhY2Nlc3NvciBmdW5jdGlvbiBmb3IgY29sbGVjdGluZyBhIHZhbHVlLlxucHJvdG8uY29sbGVjdCA9IGZ1bmN0aW9uKGssIGYpIHtcbiAgaWYgKGsgPT09IDApIHJldHVybiBbXTtcbiAgaWYgKGsgPT0gbnVsbCB8fCBrIDwgMCkgayA9IHRoaXMuX3NpemU7XG5cbiAgdmFyIGRhdGEgPSBBcnJheShrKSxcbiAgICAgIGhlYWQgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgbm9kZSwgbGlzdCwgZW50cnksIGk9MDtcblxuICBmb3IgKG5vZGUgPSBoZWFkLnByZXY7IG5vZGUgIT09IGhlYWQ7IG5vZGUgPSBub2RlLnByZXYpIHtcbiAgICBsaXN0ID0gbm9kZS5saXN0O1xuICAgIGZvciAoZW50cnkgPSBsaXN0LnByZXY7IGVudHJ5ICE9PSBsaXN0OyBlbnRyeSA9IGVudHJ5LnByZXYpIHtcbiAgICAgIGRhdGFbaSsrXSA9IGYoZW50cnkpO1xuICAgICAgaWYgKGkgPT09IGspIHJldHVybiBkYXRhO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkYXRhO1xufTtcblxuLy8gUmV0dXJuIGEgSlNPTi1jb21wYXRpYmxlIHNlcmlhbGl6ZWQgdmVyc2lvbiBvZiB0aGlzIHNrZXRjaC5cbnByb3RvLmV4cG9ydCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgaGVhZCA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBvdXQgPSBbXSwgYiwgbiwgYztcblxuICBmb3IgKGIgPSBoZWFkLm5leHQ7IGIgIT09IGhlYWQ7IGIgPSBiLm5leHQpIHtcbiAgICBmb3IgKGMgPSBbYi5jb3VudF0sIG4gPSBiLmxpc3QubmV4dDsgbiAhPT0gYi5saXN0OyBuID0gbi5uZXh0KSB7XG4gICAgICBjLnB1c2gobi52YWx1ZSwgbi5lcnJvcik7XG4gICAgfVxuICAgIG91dC5wdXNoKGMpO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB3OiB0aGlzLl93LFxuICAgIGJ1Y2tldHM6IG91dFxuICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJlYW1TdW1tYXJ5O1xuIl19
