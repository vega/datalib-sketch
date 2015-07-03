(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}(g.dl || (g.dl = {})).sketch = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// Bloom Filters test whether an element is a member of a set.
// False positive matches are possible, but false negatives are not.
// See http://en.wikipedia.org/wiki/Bloom_filter

// This code borrows heavily from http://github.com/jasondavies/bloomfilter.js

var hash = require('./hash');

var TYPED_ARRAYS = typeof ArrayBuffer !== 'undefined',
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

var TYPED_ARRAYS = typeof ArrayBuffer !== 'undefined',
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
  StreamSummary: require('./stream-summary'),
  TDigest:       require('./t-digest')
};
},{"./bloom":1,"./count-mean-min":2,"./count-min":3,"./ngram":6,"./stream-summary":7,"./t-digest":8}],6:[function(require,module,exports){
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

},{}],8:[function(require,module,exports){
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
  tempsize = ~~(7.5 + 0.37*cf - 2e-4*cf*cf);
  // should only need ceil(cf * PI / 2), double allocation for safety
  size = Math.ceil(Math.PI * cf);

  this._cf = cf; // compression factor

  this._totalSum = 0;
  this._last = 0;
  this._weight = numArray(size);
  this._mean = numArray(size);
  this._min = Number.MAX_VALUE;
  this._max = -Number.MAX_VALUE;

  this._unmergedSum = 0;
  this._mergeWeight = numArray(size);
  this._mergeMean = numArray(size);

  this._tempLast = 0;
  this._tempWeight = numArray(tempsize);
  this._tempMean = numArray(tempsize);
  this._order = [];
}

function numArray(size) {
  return TYPED_ARRAYS ? new Float64Array(size) : Array(size);
}

function integrate(cf, q) {
  return cf * (Math.asin(2 * q - 1) + Math.PI / 2) / Math.PI;
}

function interpolate(x, x0, x1) {
  return (x - x0) / (x1 - x0);
}

// Create a new t-digest sketch from a serialized object.
TDigest.import = function(obj) {
  var td = new TDigest(obj.compress);
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

// Add a value to the t-digest.
// Argument *v* is the value to add.
// Argument *count* is the integer number of occurrences to add.
// If not provided, *count* defaults to 1.
proto.add = function(v, count) {
  if (v == null || v !== v) return; // ignore null, NaN
  count = count || 1;
  
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

  // get sort order for temp values
  order.length = tn;
  for (i=0; i<tn; ++i) order[i] = i;
  order.sort(function(a,b) { return tu[a] - tu[b]; });

  if (this._totalSum > 0) {
    if (w[this._last] > 0) {
      n = this._last + 1;
    } else {
      n = this._last;
    }
  }
  this._last = 0;
  this._totalSum += this._unmergedSum;
  this._unmergedSum = 0;

  // merge tempWeight,tempMean and weight,mean into mergeWeight,mergeMean
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
  for (; i < tn; ++i) {
    ii = order[i];
    sum += tw[ii];
    k1 = this._mergeCentroid(sum, k1, tw[ii], tu[ii]);
  }
  for (; j < n; ++j) {
    sum += w[j];
    k1 = this._mergeCentroid(sum, k1, w[j], u[j]);
  }
  this._tempLast = 0;

  // swap pointers for working space and merge space
  this._weight = this._mergeWeight;
  this._mergeWeight = w;
  for (i=0, n=w.length; i<n; ++i) w[i] = 0;

  this._mean = this._mergeMean;
  this._mergeMean = u;

  if (this._weight[n = this._last] <= 0) --n;
  this._min = Math.min(this._min, this._mean[0]);
  this._max = Math.max(this._max, this._mean[n]);
};

proto._mergeCentroid = function(sum, k1, wt, ut) {
  var w = this._mergeWeight,
      u = this._mergeMean,
      n = this._last,
      k2 = integrate(this._cf, sum / this._totalSum);

  if (k2 - k1 <= 1 || w[n] === 0) {
    // merge into existing centroid
    w[n] += wt;
    u[n] = u[n] + (ut - u[n]) * wt / w[n];
  } else {
    // create new centroid
    this._last = ++n;
    u[n] = ut;
    w[n] = wt;
    k1 = integrate(this._cf, (sum - wt) / this._totalSum);
  }

  return k1;
};

// The number of values that have been added to this sketch.
proto.size = function() {
  return this._totalSum + this._unmergedSum;
};

// Query for estimated quantile *q*.
// Argument *q* is a desired quantile in the range (0,1)
// For example, q = 0.5 queries for the median.
proto.quantile = function(q) {
  this._mergeValues();
  q = q * this._totalSum;

  var w = this._weight,
      u = this._mean,
      n = this._last,
      max = this._max,
      ua = u[0], ub, // means
      wa = w[0], wb, // weights
      left = this._min, right,
      sum = 0, p, i;

  if (n === 0) return w[n] === 0 ? NaN : u[0];
  if (w[n] > 0) ++n;

  for (i=1; i<n; ++i) {
    ub = u[i];
    wb = w[i];
    right = (wb * ua + wa * ub) / (wa + wb);

    if (q < sum + wa) {
      p = (q - sum) / wa;
      return left * (1-p) + right * p;
    }

    sum += wa;
    ua = ub;
    wa = wb;
    left = right;
  }

  right = max;
  if (q < sum + wa) {
    p = (q - sum) / wa;
    return left * (1-p) + right * p;
  } else {
    return max;
  }
};

// Query for fraction of values <= *v*.
proto.cdf = function(v) {
  this._mergeValues();

  var total = this._totalSum,
      w = this._weight,
      u = this._mean,
      n = this._last,
      min = this._min,
      max = this._max,
      ua = min, ub, // means
      wa = 0,   wb, // weights
      sum = 0, left = 0, right, i;

  if (n === 0) {
    return w[n] === 0 ? NaN :
      v < min ? 0 :
      v > max ? 1 :
      (max - min < EPSILON) ? 0.5 :
      interpolate(v, min, max);
  }
  if (w[n] > 0) ++n;

  // find enclosing pair of centroids (treat min as a virtual centroid)
  for (i=0; i<n; ++i) {
    ub = u[i];
    wb = w[i];
    right = (ub - ua) * wa / (wa + wb);

    // we know that v >= ua-left
    if (v < ua + right) {
      v = (sum + wa * interpolate(v, ua-left, ua+right)) / total;
      return v > 0 ? v : 0;
    }

    sum += wa;
    left = ub - (ua + right);
    ua = ub;
    wa = wb;
  }

  // for the last element, use max to determine right
  right = max - ua;
  return  (v < ua + right) ?
    (sum + wa * interpolate(v, ua-left, ua+right)) / total :
    1;
};

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
    compress: this._cf,
    min:      this._min,
    max:      this._max,
    mean:     [].slice.call(this._mean, 0, this._last+1),
    weight:   [].slice.call(this._weight, 0, this._last+1)
  };
};

module.exports = TDigest;

},{}]},{},[5])(5)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYmxvb20uanMiLCJzcmMvY291bnQtbWVhbi1taW4uanMiLCJzcmMvY291bnQtbWluLmpzIiwic3JjL2hhc2guanMiLCJzcmMvaW5kZXguanMiLCJzcmMvbmdyYW0uanMiLCJzcmMvc3RyZWFtLXN1bW1hcnkuanMiLCJzcmMvdC1kaWdlc3QuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vIEJsb29tIEZpbHRlcnMgdGVzdCB3aGV0aGVyIGFuIGVsZW1lbnQgaXMgYSBtZW1iZXIgb2YgYSBzZXQuXG4vLyBGYWxzZSBwb3NpdGl2ZSBtYXRjaGVzIGFyZSBwb3NzaWJsZSwgYnV0IGZhbHNlIG5lZ2F0aXZlcyBhcmUgbm90LlxuLy8gU2VlIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQmxvb21fZmlsdGVyXG5cbi8vIFRoaXMgY29kZSBib3Jyb3dzIGhlYXZpbHkgZnJvbSBodHRwOi8vZ2l0aHViLmNvbS9qYXNvbmRhdmllcy9ibG9vbWZpbHRlci5qc1xuXG52YXIgaGFzaCA9IHJlcXVpcmUoJy4vaGFzaCcpO1xuXG52YXIgVFlQRURfQVJSQVlTID0gdHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyxcbiAgICBERUZBVUxUX0JJVFMgPSAxMDI0ICogMTAyNCAqIDgsIC8vIDFNQlxuICAgIERFRkFVTFRfSEFTSCA9IDU7IC8vIE9wdGltYWwgZm9yIDIlIEZQUiBvdmVyIDFNIGVsZW1lbnRzXG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIuIElmICp3KiBpcyBhbiBhcnJheS1saWtlIG9iamVjdCwgd2l0aCBhIGxlbmd0aFxuLy8gcHJvcGVydHksIHRoZW4gdGhlIGJsb29tIGZpbHRlciBpcyBsb2FkZWQgd2l0aCBkYXRhIGZyb20gdGhlIGFycmF5LCB3aGVyZVxuLy8gZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuIE90aGVyd2lzZSwgKncqIHNob3VsZCBzcGVjaWZ5IHRoZSB3aWR0aFxuLy8gb2YgdGhlIGZpbHRlciBpbiBiaXRzLiBOb3RlIHRoYXQgKncqIGlzIHJvdW5kZWQgdXAgdG8gdGhlIG5lYXJlc3QgbXVsdGlwbGVcbi8vIG9mIDMyLiAqZCogKHRoZSBmaWx0ZXIgZGVwdGgpIHNwZWNpZmllcyB0aGUgbnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zLlxuZnVuY3Rpb24gQmxvb21GaWx0ZXIodywgZCkge1xuICB3ID0gdyB8fCBERUZBVUxUX0JJVFM7XG4gIGQgPSBkIHx8IERFRkFVTFRfSEFTSDtcblxuICB2YXIgYTtcbiAgaWYgKHR5cGVvZiB3ICE9PSBcIm51bWJlclwiKSB7IGEgPSB3OyB3ID0gYS5sZW5ndGggKiAzMjsgfVxuXG4gIHZhciBuID0gTWF0aC5jZWlsKHcgLyAzMiksXG4gICAgICBpID0gLTEsIGJ1Y2tldHM7XG4gIHRoaXMuX3cgPSB3ID0gbiAqIDMyO1xuICB0aGlzLl9kID0gZDtcblxuICBpZiAoVFlQRURfQVJSQVlTKSB7XG4gICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMgPSBuZXcgSW50MzJBcnJheShuKTtcbiAgICBpZiAoYSkgd2hpbGUgKCsraSA8IG4pIGJ1Y2tldHNbaV0gPSBhW2ldO1xuICB9IGVsc2Uge1xuICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzID0gW107XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gYVtpXTtcbiAgICBlbHNlIHdoaWxlICgrK2kgPCBuKSBidWNrZXRzW2ldID0gMDtcbiAgfVxuICBoYXNoLmluaXQuY2FsbCh0aGlzKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IGJsb29tIGZpbHRlciBiYXNlZCBvbiBwcm92aWRlZCBwZXJmb3JtYW5jZSBwYXJhbWV0ZXJzLlxuLy8gQXJndW1lbnQgKm4qIGlzIHRoZSBleHBlY3RlZCBzZXQgc2l6ZSAoY2FyZGluYWxpdHkpLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBkZXNpcmVkIGZhbHNlIHBvc2l0aXZlIHJhdGUuXG4vLyBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jsb29tX2ZpbHRlciNPcHRpbWFsX251bWJlcl9vZl9oYXNoX2Z1bmN0aW9uc1xuQmxvb21GaWx0ZXIuY3JlYXRlID0gZnVuY3Rpb24obiwgcCkge1xuICB2YXIgdyA9IC1uICogTWF0aC5sb2cocCkgLyAoTWF0aC5MTjIgKiBNYXRoLkxOMiksXG4gICAgICBkID0gKHcgLyBuKSAqIE1hdGguTE4yO1xuICByZXR1cm4gbmV3IEJsb29tRmlsdGVyKH5+dywgfn5kKTtcbn07XG5cbi8vIENyZWF0ZSBhIG5ldyBibG9vbSBmaWx0ZXIgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuQmxvb21GaWx0ZXIuaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIob2JqLmJpdHMsIG9iai5kZXB0aCk7XG59O1xuXG52YXIgcHJvdG8gPSBCbG9vbUZpbHRlci5wcm90b3R5cGU7XG5cbnByb3RvLmxvY2F0aW9ucyA9IGhhc2gubG9jYXRpb25zO1xuXG4vLyBBZGQgYSB2YWx1ZSB0byB0aGUgZmlsdGVyLlxucHJvdG8uYWRkID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICBpID0gLTEsXG4gICAgICBkID0gdGhpcy5fZCxcbiAgICAgIGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRzO1xuICB3aGlsZSAoKytpIDwgZCkgYnVja2V0c1tNYXRoLmZsb29yKGxbaV0gLyAzMildIHw9IDEgPDwgKGxbaV0gJSAzMik7XG59O1xuXG4vLyBRdWVyeSBmb3IgaW5jbHVzaW9uIGluIHRoZSBmaWx0ZXIuXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKHYpIHtcbiAgdmFyIGwgPSB0aGlzLmxvY2F0aW9ucyh2ICsgJycpLFxuICAgICAgaSA9IC0xLFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBiLFxuICAgICAgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHM7XG4gIHdoaWxlICgrK2kgPCBkKSB7XG4gICAgYiA9IGxbaV07XG4gICAgaWYgKChidWNrZXRzW01hdGguZmxvb3IoYiAvIDMyKV0gJiAoMSA8PCAoYiAlIDMyKSkpID09PSAwKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gRXN0aW1hdGVkIGNhcmRpbmFsaXR5LlxucHJvdG8uc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYnVja2V0cyA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiaXRzID0gMCwgaSwgbjtcbiAgZm9yIChpPTAsIG49YnVja2V0cy5sZW5ndGg7IGk8bjsgKytpKSBiaXRzICs9IGJpdGNvdW50KGJ1Y2tldHNbaV0pO1xuICByZXR1cm4gLXRoaXMuX3cgKiBNYXRoLmxvZygxIC0gYml0cyAvIHRoaXMuX3cpIC8gdGhpcy5fZDtcbn07XG5cbi8vIFVuaW9uIHRoaXMgYmxvb20gZmlsdGVyIHdpdGggYW5vdGhlci5cbi8vIFRoZSBpbnB1dCBmaWx0ZXIgbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLnVuaW9uID0gZnVuY3Rpb24oYmYpIHtcbiAgaWYgKGJmLl93ICE9PSB0aGlzLl93KSB0aHJvdyAnRmlsdGVyIHdpZHRocyBkbyBub3QgbWF0Y2guJztcbiAgaWYgKGJmLl9kICE9PSB0aGlzLl9kKSB0aHJvdyAnRmlsdGVyIGRlcHRocyBkbyBub3QgbWF0Y2guJztcblxuICB2YXIgYSA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBiID0gYmYuX2J1Y2tldHMsXG4gICAgICBuID0gYS5sZW5ndGgsXG4gICAgICB6ID0gVFlQRURfQVJSQVlTID8gbmV3IEludDMyQXJyYXkobikgOiBBcnJheShuKSxcbiAgICAgIGk7XG5cbiAgZm9yIChpPTA7IGk8bjsgKytpKSB7XG4gICAgeltpXSA9IGFbaV0gfCBiW2ldO1xuICB9XG4gIHJldHVybiBuZXcgQmxvb21GaWx0ZXIoeiwgdGhpcy5fZCk7XG59O1xuXG4vLyBJbnRlcm5hbCBoZWxwZXIgbWV0aG9kIGZvciBibG9vbSBmaWx0ZXIgY29tcGFyaXNvbiBlc3RpbWF0ZXMuXG5wcm90by5fZXN0aW1hdGUgPSBmdW5jdGlvbihiZiwga2VybmVsKSB7XG4gIGlmIChiZi5fdyAhPT0gdGhpcy5fdykgdGhyb3cgJ0ZpbHRlciB3aWR0aHMgZG8gbm90IG1hdGNoLic7XG4gIGlmIChiZi5fZCAhPT0gdGhpcy5fZCkgdGhyb3cgJ0ZpbHRlciBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIGEgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgYiA9IGJmLl9idWNrZXRzLFxuICAgICAgbiA9IGEubGVuZ3RoLFxuICAgICAgeCwgeSwgeiwgaTtcblxuICBmb3IgKGk9eD15PXo9MDsgaTxuOyArK2kpIHtcbiAgICB4ICs9IGJpdGNvdW50KGFbaV0pO1xuICAgIHkgKz0gYml0Y291bnQoYltpXSk7XG4gICAgeiArPSBiaXRjb3VudChhW2ldIHwgYltpXSk7XG4gIH1cbiAgeCA9IE1hdGgubG9nKDEgLSB4IC8gdGhpcy5fdyk7XG4gIHkgPSBNYXRoLmxvZygxIC0geSAvIHRoaXMuX3cpO1xuICB6ID0gTWF0aC5sb2coMSAtIHogLyB0aGlzLl93KTtcbiAgcmV0dXJuIGtlcm5lbCh4LCB5LCB6KTtcbn07XG5cbi8vIEphY2NhcmQgY28tZWZmaWNpZW50IG9mIHR3byBibG9vbSBmaWx0ZXJzLlxuLy8gVGhlIGlucHV0IGZpbHRlciBtdXN0IGhhdmUgdGhlIHNhbWUgc2l6ZSBhbmQgaGFzaCBjb3VudC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmphY2NhcmQgPSBmdW5jdGlvbihiZikge1xuICByZXR1cm4gdGhpcy5fZXN0aW1hdGUoYmYsIGZ1bmN0aW9uKGEsIGIsIHVuaW9uKSB7XG4gICAgcmV0dXJuIHVuaW9uID8gKGEgKyBiKSAvIHVuaW9uIC0gMSA6IDA7XG4gIH0pO1xufTtcblxuLy8gU2V0IGNvdmVyIG92ZXIgdGhlIHNtYWxsZXIgb2YgdHdvIGJsb29tIGZpbHRlcnMuXG4vLyBUaGUgaW5wdXQgZmlsdGVyIG11c3QgaGF2ZSB0aGUgc2FtZSBzaXplIGFuZCBoYXNoIGNvdW50LlxuLy8gT3RoZXJ3aXNlLCB0aGlzIG1ldGhvZCB3aWxsIHRocm93IGFuIGVycm9yLlxucHJvdG8uY292ZXIgPSBmdW5jdGlvbihiZikge1xuICByZXR1cm4gdGhpcy5fZXN0aW1hdGUoYmYsIGZ1bmN0aW9uKGEsIGIsIHVuaW9uKSB7XG4gICAgdmFyIGRlbm9tID0gTWF0aC5tYXgoYSwgYik7XG4gICAgcmV0dXJuIGRlbm9tID8gKGEgKyBiIC0gdW5pb24pIC8gZGVub20gOiAwO1xuICB9KTtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBmaWx0ZXIuXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICBkZXB0aDogdGhpcy5fZCxcbiAgICBiaXRzOiBbXS5zbGljZS5jYWxsKHRoaXMuX2J1Y2tldHMpXG4gIH07XG59O1xuXG4vLyBodHRwOi8vZ3JhcGhpY3Muc3RhbmZvcmQuZWR1L35zZWFuZGVyL2JpdGhhY2tzLmh0bWwjQ291bnRCaXRzU2V0UGFyYWxsZWxcbmZ1bmN0aW9uIGJpdGNvdW50KHYpIHtcbiAgdiAtPSAodiA+PiAxKSAmIDB4NTU1NTU1NTU7XG4gIHYgPSAodiAmIDB4MzMzMzMzMzMpICsgKCh2ID4+IDIpICYgMHgzMzMzMzMzMyk7XG4gIHJldHVybiAoKHYgKyAodiA+PiA0KSAmIDB4RjBGMEYwRikgKiAweDEwMTAxMDEpID4+IDI0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb29tRmlsdGVyOyIsIi8vIENvdW50LU1lYW4tTWluIHNrZXRjaGVzIGV4dGVuZCBDb3VudC1NaW4gd2l0aCBpbXByb3ZlZCBlc3RpbWF0aW9uLlxuLy8gU2VlICdOZXcgRXN0aW1hdGlvbiBBbGdvcml0aG1zIGZvciBTdHJlYW1pbmcgRGF0YTogQ291bnQtbWluIENhbiBEbyBNb3JlJ1xuLy8gYnkgRGVuZyAmIFJhZmllaSwgaHR0cDovL3dlYmRvY3MuY3MudWFsYmVydGEuY2EvfmZhbmRlbmcvcGFwZXIvY21tLnBkZlxuXG52YXIgQ291bnRNaW4gPSByZXF1aXJlKCcuL2NvdW50LW1pbicpO1xuXG4vLyBDcmVhdGUgYSBuZXcgQ291bnQtTWVhbi1NaW4gc2tldGNoLlxuLy8gSWYgYXJndW1lbnQgKncqIGlzIGFuIGFycmF5LWxpa2Ugb2JqZWN0LCB3aXRoIGEgbGVuZ3RoIHByb3BlcnR5LCB0aGVuIHRoZVxuLy8gc2tldGNoIGlzIGxvYWRlZCB3aXRoIGRhdGEgZnJvbSB0aGUgYXJyYXksIGVhY2ggZWxlbWVudCBpcyBhIDMyLWJpdCBpbnRlZ2VyLlxuLy8gT3RoZXJ3aXNlLCAqdyogc3BlY2lmaWVzIHRoZSB3aWR0aCAobnVtYmVyIG9mIHJvdyBlbnRyaWVzKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKmQqIHNwZWNpZmllcyB0aGUgZGVwdGggKG51bWJlciBvZiBoYXNoIGZ1bmN0aW9ucykgb2YgdGhlIHNrZXRjaC5cbi8vIEFyZ3VtZW50ICpudW0qIGluZGljYXRlcyB0aGUgbnVtYmVyIG9mIGVsZW1lbnRzIGFkZC4gVGhpcyBzaG91bGQgb25seSBiZVxuLy8gcHJvdmlkZWQgaWYgKncqIGlzIGFuIGFycmF5LCBpbiB3aGljaCBjYXNlICpudW0qIGlzIHJlcXVpcmVkLlxuZnVuY3Rpb24gQ291bnRNZWFuTWluKHcsIGQsIG51bSkge1xuICBDb3VudE1pbi5jYWxsKHRoaXMsIHcsIGQsIG51bSk7XG4gIHRoaXMuX3EgPSBBcnJheShkKTtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggYmFzZWQgb24gcHJvdmlkZWQgcGVyZm9ybWFuY2UgcGFyYW1ldGVycy5cbi8vIEFyZ3VtZW50ICpuKiBpcyB0aGUgZXhwZWN0ZWQgY291bnQgb2YgYWxsIGVsZW1lbnRzXG4vLyBBcmd1bWVudCAqZSogaXMgdGhlIGFjY2VwdGFibGUgYWJzb2x1dGUgZXJyb3IuXG4vLyBBcmd1bWVudCAqcCogaXMgdGhlIHByb2JhYmlsaXR5IG9mIG5vdCBhY2hpZXZpbmcgdGhlIGVycm9yIGJvdW5kLlxuQ291bnRNZWFuTWluLmNyZWF0ZSA9IENvdW50TWluLmNyZWF0ZTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1lYW4tTWluIHNrZXRjaCBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3QuXG5Db3VudE1lYW5NaW4uaW1wb3J0ID0gQ291bnRNaW4uaW1wb3J0O1xuXG52YXIgcHJvdG8gPSAoQ291bnRNZWFuTWluLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoQ291bnRNaW4ucHJvdG90eXBlKSk7XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odikge1xuICB2YXIgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICBxID0gdGhpcy5fcSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsXG4gICAgICBuID0gdGhpcy5fbnVtLFxuICAgICAgcyA9IDEgLyAody0xKSxcbiAgICAgIG1pbiA9ICtJbmZpbml0eSwgYywgaSwgcjtcblxuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIGMgPSB0W3IgKyBsW2ldXTtcbiAgICBpZiAoYyA8IG1pbikgbWluID0gYztcbiAgICBjID0gYyAtIChuLWMpICogcztcbiAgICBxW2ldID0gYztcbiAgfVxuXG4gIHJldHVybiAoYyA9IG1lZGlhbihxKSkgPCAwID8gMCA6IGMgPiBtaW4gPyBtaW4gOiBjO1xufTtcblxuLy8gQXBwcm94aW1hdGUgZG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgaWYgKHRoaXMuX3cgIT09IHRoYXQuX3cpIHRocm93ICdTa2V0Y2ggd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAodGhpcy5fZCAhPT0gdGhhdC5fZCkgdGhyb3cgJ1NrZXRjaCBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIHRhID0gdGhpcy5fdGFibGUsXG4gICAgICB0YiA9IHRoYXQuX3RhYmxlLFxuICAgICAgcSA9IHRoaXMuX3EsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIG4gPSB0aGlzLl9udW0sXG4gICAgICBtID0gdGhpcy5fZCAqIHcsXG4gICAgICB6ID0gKHcgLSAxKSAvIHcsXG4gICAgICBzID0gMSAvICh3LTEpLFxuICAgICAgZG90ID0gMCwgaSA9IDA7XG5cbiAgZG8ge1xuICAgIGRvdCArPSAodGFbaV0gLSAobi10YVtpXSkqcykgKiAodGJbaV0gLSAobi10YltpXSkqcyk7XG4gICAgaWYgKCsraSAlIHcgPT09IDApIHtcbiAgICAgIHFbaS93LTFdID0geiAqIGRvdDtcbiAgICAgIGRvdCA9IDA7XG4gICAgfVxuICB9IHdoaWxlIChpIDwgbSk7XG5cbiAgcmV0dXJuIChkb3QgPSBtZWRpYW4ocSkpIDwgMCA/IDAgOiBkb3Q7XG59O1xuXG5mdW5jdGlvbiBtZWRpYW4ocSkge1xuICBxLnNvcnQobnVtY21wKTtcbiAgdmFyIG4gPSBxLmxlbmd0aCxcbiAgICAgIGggPSB+fihuLzIpO1xuICByZXR1cm4gbiAlIDIgPyBxW2hdIDogMC41ICogKHFbaC0xXSArIHFbaF0pO1xufVxuXG5mdW5jdGlvbiBudW1jbXAoYSwgYikge1xuICByZXR1cm4gYSAtIGI7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQ291bnRNZWFuTWluO1xuIiwidmFyIGhhc2ggPSByZXF1aXJlKCcuL2hhc2gnKTtcblxudmFyIFRZUEVEX0FSUkFZUyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcsXG4gICAgREVGQVVMVF9CSU5TID0gMjcxOTEsXG4gICAgREVGQVVMVF9IQVNIID0gOTtcblxuLy8gQ3JlYXRlIGEgbmV3IENvdW50LU1pbiBza2V0Y2ggZm9yIGFwcHJveGltYXRlIGNvdW50cyBvZiB2YWx1ZSBmcmVxdWVuY2llcy5cbi8vIFNlZTogJ0FuIEltcHJvdmVkIERhdGEgU3RyZWFtIFN1bW1hcnk6IFRoZSBDb3VudC1NaW4gU2tldGNoIGFuZCBpdHNcbi8vIEFwcGxpY2F0aW9ucycgYnkgRy4gQ29ybW9kZSAmIFMuIE11dGh1a3Jpc2huYW4uXG4vLyBJZiBhcmd1bWVudCAqdyogaXMgYW4gYXJyYXktbGlrZSBvYmplY3QsIHdpdGggYSBsZW5ndGggcHJvcGVydHksIHRoZW4gdGhlXG4vLyBza2V0Y2ggaXMgbG9hZGVkIHdpdGggZGF0YSBmcm9tIHRoZSBhcnJheSwgZWFjaCBlbGVtZW50IGlzIGEgMzItYml0IGludGVnZXIuXG4vLyBPdGhlcndpc2UsICp3KiBzcGVjaWZpZXMgdGhlIHdpZHRoIChudW1iZXIgb2Ygcm93IGVudHJpZXMpIG9mIHRoZSBza2V0Y2guXG4vLyBBcmd1bWVudCAqZCogc3BlY2lmaWVzIHRoZSBkZXB0aCAobnVtYmVyIG9mIGhhc2ggZnVuY3Rpb25zKSBvZiB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKm51bSogaW5kaWNhdGVzIHRoZSBudW1iZXIgb2YgZWxlbWVudHMgYWRkLiBUaGlzIHNob3VsZCBvbmx5IGJlXG4vLyBwcm92aWRlZCBpZiAqdyogaXMgYW4gYXJyYXksIGluIHdoaWNoIGNhc2UgKm51bSogaXMgcmVxdWlyZWQuXG5mdW5jdGlvbiBDb3VudE1pbih3LCBkLCBudW0pIHtcbiAgdyA9IHcgfHwgREVGQVVMVF9CSU5TO1xuICBkID0gZCB8fCBERUZBVUxUX0hBU0g7XG5cbiAgdmFyIGEsIHQsIGk9LTEsIG47XG4gIGlmICh0eXBlb2YgdyAhPT0gXCJudW1iZXJcIikgeyBhID0gdzsgdyA9IGEubGVuZ3RoIC8gZDsgfVxuICB0aGlzLl93ID0gdztcbiAgdGhpcy5fZCA9IGQ7XG4gIHRoaXMuX251bSA9IG51bSB8fCAwO1xuICBuID0gdyAqIGQ7XG5cbiAgaWYgKFRZUEVEX0FSUkFZUykge1xuICAgIHQgPSB0aGlzLl90YWJsZSA9IG5ldyBJbnQzMkFycmF5KG4pO1xuICAgIGlmIChhKSB3aGlsZSAoKytpIDwgbikgdFtpXSA9IGFbaV07XG4gIH0gZWxzZSB7XG4gICAgdCA9IHRoaXMuX3RhYmxlID0gQXJyYXkobik7XG4gICAgaWYgKGEpIHdoaWxlICgrK2kgPCBuKSB0W2ldID0gYVtpXTtcbiAgICB3aGlsZSAoKytpIDwgbikgdFtpXSA9IDA7XG4gIH1cbiAgaGFzaC5pbml0LmNhbGwodGhpcyk7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGJhc2VkIG9uIHByb3ZpZGVkIHBlcmZvcm1hbmNlIHBhcmFtZXRlcnMuXG4vLyBBcmd1bWVudCAqbiogaXMgdGhlIGV4cGVjdGVkIGNvdW50IG9mIGFsbCBlbGVtZW50c1xuLy8gQXJndW1lbnQgKmUqIGlzIHRoZSBhY2NlcHRhYmxlIGFic29sdXRlIGVycm9yLlxuLy8gQXJndW1lbnQgKnAqIGlzIHRoZSBwcm9iYWJpbGl0eSBvZiBub3QgYWNoaWV2aW5nIHRoZSBlcnJvciBib3VuZC5cbi8vIGh0dHA6Ly9kaW1hY3MucnV0Z2Vycy5lZHUvfmdyYWhhbS9wdWJzL3BhcGVycy9jbWVuY3ljLnBkZlxuQ291bnRNaW4uY3JlYXRlID0gZnVuY3Rpb24obiwgZSwgcCkge1xuICBlID0gbiA/IChlID8gZS9uIDogMS9uKSA6IDAuMDAxO1xuICBwID0gcCB8fCAwLjAwMTtcbiAgdmFyIHcgPSBNYXRoLmNlaWwoTWF0aC5FIC8gZSksXG4gICAgICBkID0gTWF0aC5jZWlsKC1NYXRoLmxvZyhwKSk7XG4gIHJldHVybiBuZXcgdGhpcyh3LCBkKTtcbn07XG5cbi8vIENyZWF0ZSBhIG5ldyBDb3VudC1NaW4gc2tldGNoIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdC5cbkNvdW50TWluLmltcG9ydCA9IGZ1bmN0aW9uKG9iaikge1xuICByZXR1cm4gbmV3IHRoaXMob2JqLmNvdW50cywgb2JqLmRlcHRoLCBvYmoubnVtKTtcbn07XG5cbnZhciBwcm90byA9IENvdW50TWluLnByb3RvdHlwZTtcblxucHJvdG8ubG9jYXRpb25zID0gaGFzaC5sb2NhdGlvbnM7XG5cbi8vIEFkZCBhIHZhbHVlIHRvIHRoZSBza2V0Y2guXG5wcm90by5hZGQgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBsID0gdGhpcy5sb2NhdGlvbnModiArICcnKSxcbiAgICAgIHQgPSB0aGlzLl90YWJsZSxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgZCA9IHRoaXMuX2QsIGksIHI7XG4gIGZvciAoaT0wLCByPTA7IGk8ZDsgKytpLCByKz13KSB7XG4gICAgdFtyICsgbFtpXV0gKz0gMTtcbiAgfVxuICB0aGlzLl9udW0gKz0gMTtcbn07XG5cbi8vIFF1ZXJ5IGZvciBhcHByb3hpbWF0ZSBjb3VudC5cbnByb3RvLnF1ZXJ5ID0gZnVuY3Rpb24odikge1xuICB2YXIgbWluID0gK0luZmluaXR5LFxuICAgICAgbCA9IHRoaXMubG9jYXRpb25zKHYgKyAnJyksXG4gICAgICB0ID0gdGhpcy5fdGFibGUsXG4gICAgICB3ID0gdGhpcy5fdyxcbiAgICAgIGQgPSB0aGlzLl9kLCBpLCByLCBjO1xuICBmb3IgKGk9MCwgcj0wOyBpPGQ7ICsraSwgcis9dykge1xuICAgIGMgPSB0W3IgKyBsW2ldXTtcbiAgICBpZiAoYyA8IG1pbikgbWluID0gYztcbiAgfVxuICByZXR1cm4gbWluO1xufTtcblxuLy8gQXBwcm94aW1hdGUgZG90IHByb2R1Y3Qgd2l0aCBhbm90aGVyIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggbXVzdCBoYXZlIHRoZSBzYW1lIGRlcHRoIGFuZCB3aWR0aC5cbi8vIE90aGVyd2lzZSwgdGhpcyBtZXRob2Qgd2lsbCB0aHJvdyBhbiBlcnJvci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgaWYgKHRoaXMuX3cgIT09IHRoYXQuX3cpIHRocm93ICdTa2V0Y2ggd2lkdGhzIGRvIG5vdCBtYXRjaC4nO1xuICBpZiAodGhpcy5fZCAhPT0gdGhhdC5fZCkgdGhyb3cgJ1NrZXRjaCBkZXB0aHMgZG8gbm90IG1hdGNoLic7XG5cbiAgdmFyIHRhID0gdGhpcy5fdGFibGUsXG4gICAgICB0YiA9IHRoYXQuX3RhYmxlLFxuICAgICAgdyA9IHRoaXMuX3csXG4gICAgICBtID0gdGhpcy5fZCAqIHcsXG4gICAgICBtaW4gPSArSW5maW5pdHksXG4gICAgICBkb3QgPSAwLCBpID0gMDtcblxuICBkbyB7XG4gICAgZG90ICs9IHRhW2ldICogdGJbaV07XG4gICAgaWYgKCsraSAlIHcgPT09IDApIHtcbiAgICAgIGlmIChkb3QgPCBtaW4pIG1pbiA9IGRvdDtcbiAgICAgIGRvdCA9IDA7XG4gICAgfVxuICB9IHdoaWxlIChpIDwgbSk7XG5cbiAgcmV0dXJuIG1pbjtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBza2V0Y2guXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICBudW06IHRoaXMuX251bSxcbiAgICBkZXB0aDogdGhpcy5fZCxcbiAgICBjb3VudHM6IFtdLnNsaWNlLmNhbGwodGhpcy5fdGFibGUpXG4gIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvdW50TWluO1xuIiwidmFyIFRZUEVEX0FSUkFZUyA9IHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIjtcblxuLy8gRm93bGVyL05vbGwvVm8gaGFzaGluZy5cbmZ1bmN0aW9uIGZudl8xYSh2KSB7XG4gIHZhciBuID0gdi5sZW5ndGgsXG4gICAgICBhID0gMjE2NjEzNjI2MSxcbiAgICAgIGMsXG4gICAgICBkLFxuICAgICAgaSA9IC0xO1xuICB3aGlsZSAoKytpIDwgbikge1xuICAgIGMgPSB2LmNoYXJDb2RlQXQoaSk7XG4gICAgaWYgKChkID0gYyAmIDB4ZmYwMDAwMDApKSB7XG4gICAgICBhIF49IGQgPj4gMjQ7XG4gICAgICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICAgIH1cbiAgICBpZiAoKGQgPSBjICYgMHhmZjAwMDApKSB7XG4gICAgICBhIF49IGQgPj4gMTY7XG4gICAgICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICAgIH1cbiAgICBpZiAoKGQgPSBjICYgMHhmZjAwKSkge1xuICAgICAgYSBePSBkID4+IDg7XG4gICAgICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICAgIH1cbiAgICBhIF49IGMgJiAweGZmO1xuICAgIGEgKz0gKGEgPDwgMSkgKyAoYSA8PCA0KSArIChhIDw8IDcpICsgKGEgPDwgOCkgKyAoYSA8PCAyNCk7XG4gIH1cbiAgLy8gRnJvbSBodHRwOi8vaG9tZS5jb21jYXN0Lm5ldC9+YnJldG0vaGFzaC82Lmh0bWxcbiAgYSArPSBhIDw8IDEzO1xuICBhIF49IGEgPj4gNztcbiAgYSArPSBhIDw8IDM7XG4gIGEgXj0gYSA+PiAxNztcbiAgYSArPSBhIDw8IDU7XG4gIHJldHVybiBhICYgMHhmZmZmZmZmZjtcbn1cblxuLy8gT25lIGFkZGl0aW9uYWwgaXRlcmF0aW9uIG9mIEZOViwgZ2l2ZW4gYSBoYXNoLlxuZnVuY3Rpb24gZm52XzFhX2IoYSkge1xuICBhICs9IChhIDw8IDEpICsgKGEgPDwgNCkgKyAoYSA8PCA3KSArIChhIDw8IDgpICsgKGEgPDwgMjQpO1xuICBhICs9IGEgPDwgMTM7XG4gIGEgXj0gYSA+PiA3O1xuICBhICs9IGEgPDwgMztcbiAgYSBePSBhID4+IDE3O1xuICBhICs9IGEgPDwgNTtcbiAgcmV0dXJuIGEgJiAweGZmZmZmZmZmO1xufVxuXG4vLyBtaXgtaW4gbWV0aG9kIGZvciBtdWx0aS1oYXNoIGluaXRpYWxpemF0aW9uXG5tb2R1bGUuZXhwb3J0cy5pbml0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBkID0gdGhpcy5fZCxcbiAgICAgIHcgPSB0aGlzLl93O1xuXG4gIGlmIChUWVBFRF9BUlJBWVMpIHtcbiAgICB2YXIga2J5dGVzID0gMSA8PCBNYXRoLmNlaWwoTWF0aC5sb2coXG4gICAgICAgICAgTWF0aC5jZWlsKE1hdGgubG9nKHcpIC8gTWF0aC5MTjIgLyA4KVxuICAgICAgICApIC8gTWF0aC5MTjIpLFxuICAgICAgICBhcnJheSA9IGtieXRlcyA9PT0gMSA/IFVpbnQ4QXJyYXkgOiBrYnl0ZXMgPT09IDIgPyBVaW50MTZBcnJheSA6IFVpbnQzMkFycmF5LFxuICAgICAgICBrYnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKGtieXRlcyAqIGQpO1xuICAgIHRoaXMuX2xvY2F0aW9ucyA9IG5ldyBhcnJheShrYnVmZmVyKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLl9sb2NhdGlvbnMgPSBbXTtcbiAgfVxufTtcblxuLy8gbWl4LWluIG1ldGhvZCBmb3IgbXVsdGktaGFzaCBjYWxjdWxhdGlvblxuLy8gU2VlIGh0dHA6Ly93aWxsd2hpbS53b3JkcHJlc3MuY29tLzIwMTEvMDkvMDMvcHJvZHVjaW5nLW4taGFzaC1mdW5jdGlvbnMtYnktaGFzaGluZy1vbmx5LW9uY2UvXG5tb2R1bGUuZXhwb3J0cy5sb2NhdGlvbnMgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBkID0gdGhpcy5fZCxcbiAgICAgIHcgPSB0aGlzLl93LFxuICAgICAgciA9IHRoaXMuX2xvY2F0aW9ucyxcbiAgICAgIGEgPSBmbnZfMWEodiksXG4gICAgICBiID0gZm52XzFhX2IoYSksXG4gICAgICBpID0gLTEsXG4gICAgICB4ID0gYSAlIHc7XG4gIHdoaWxlICgrK2kgPCBkKSB7XG4gICAgcltpXSA9IHggPCAwID8gKHggKyB3KSA6IHg7XG4gICAgeCA9ICh4ICsgYikgJSB3O1xuICB9XG4gIHJldHVybiByO1xufTtcblxubW9kdWxlLmV4cG9ydHMuZm52XzFhID0gZm52XzFhO1xubW9kdWxlLmV4cG9ydHMuZm52XzFhX2IgPSBmbnZfMWFfYjtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1xuICBCbG9vbTogICAgICAgICByZXF1aXJlKCcuL2Jsb29tJyksXG4gIENvdW50TWluOiAgICAgIHJlcXVpcmUoJy4vY291bnQtbWluJyksXG4gIENvdW50TWVhbk1pbjogIHJlcXVpcmUoJy4vY291bnQtbWVhbi1taW4nKSxcbiAgTkdyYW06ICAgICAgICAgcmVxdWlyZSgnLi9uZ3JhbScpLFxuICBTdHJlYW1TdW1tYXJ5OiByZXF1aXJlKCcuL3N0cmVhbS1zdW1tYXJ5JyksXG4gIFREaWdlc3Q6ICAgICAgIHJlcXVpcmUoJy4vdC1kaWdlc3QnKVxufTsiLCIvLyBDcmVhdGUgYSBuZXcgY2hhcmFjdGVyLWxldmVsIG4tZ3JhbSBza2V0Y2guXG4vLyAqbiogaXMgdGhlIG51bWJlciBvZiBjaGFyYWN0ZXJzIHRvIGluY2x1ZGUsIGRlZmF1bHRzIHRvIDIuXG4vLyAqY2FzZVNlbnNpdGl2ZSogaW5kaWNhdGVzIGNhc2Utc2Vuc2l0aXZpdHksIGRlZmF1bHRzIHRvIGZhbHNlLlxuLy8gKm1hcCogaXMgYW4gb3B0aW9uYWwgZXhpc3RpbmcgbmdyYW0gdG8gY291bnQgbWFwLlxuZnVuY3Rpb24gTkdyYW0obiwgY2FzZVNlbnNpdGl2ZSwgbWFwKSB7XG4gIHRoaXMuX24gPSBuID09IG51bGwgPyAyIDogbjtcbiAgdGhpcy5fY2FzZSA9ICEhY2FzZVNlbnNpdGl2ZTtcbiAgdGhpcy5fbWFwID0gbWFwIHx8IHt9O1xuICB0aGlzLl9ub3JtID0gbnVsbDtcbn1cblxuTkdyYW0uaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiBuZXcgTkdyYW0ob2JqLm4sIG9iai5jYXNlLCBvYmouY291bnRzKTtcbn07XG5cbnZhciBwcm90byA9IE5HcmFtLnByb3RvdHlwZTtcblxuLy8gQWRkIGFsbCBjb25zZWN1dGl2ZSBuLWdyYW1zIGluICpzKiB0byB0aGlzIHNrZXRjaFxucHJvdG8uYWRkID0gZnVuY3Rpb24ocykge1xuICBpZiAocyA9PSBudWxsIHx8IHMgPT09ICcnKSByZXR1cm47XG4gIHRoaXMuX25vcm0gPSBudWxsO1xuICBjb3VudHMoU3RyaW5nKHMpLCB0aGlzLl9uLCB0aGlzLl9jYXNlLCB0aGlzLl9tYXApO1xufTtcblxuLy8gYWRkIGNvdW50cyBvZiBuLWdyYW1zIGluIHN0cmluZyB0byBhIG1hcFxuZnVuY3Rpb24gY291bnRzKHMsIG4sIGMsIG1hcCkge1xuICB2YXIgbGVuID0gcy5sZW5ndGggLSBuICsgMSxcbiAgICAgIGssIGk7XG4gIFxuICBmb3IgKGk9MDsgaTxsZW47ICsraSkge1xuICAgIGsgPSBzLnN1YnN0cihpLCBuKTtcbiAgICBpZiAoIWMpIGsgPSBrLnRvTG93ZXJDYXNlKCk7XG4gICAgbWFwW2tdID0gbWFwW2tdID8gbWFwW2tdICsgMSA6IDE7XG4gIH1cbn1cblxuLy8gVGhlIG9jY3VycmVuY2UgY291bnQgb2YgYSBnaXZlbiBuLWdyYW0uXG5wcm90by5xdWVyeSA9IGZ1bmN0aW9uKGtleSkge1xuICByZXR1cm4gdGhpcy5fbWFwW3RoaXMuX2Nhc2UgPyBrZXkgOiBrZXkudG9Mb3dlckNhc2UoKV0gfHwgMDtcbn07XG5cbi8vIFJldHVybiB0aGUgbnVtYmVyIG9mIHVuaXF1ZSBuLWdyYW1zIG9ic2VydmVkLlxucHJvdG8uc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fbWFwKS5sZW5ndGg7XG59O1xuXG4vLyBSZXR1cm4gdGhlIHZlY3RvciBub3JtIG9mIHRoZSBjb3VudHMgaW4gdGhpcyBza2V0Y2guXG5wcm90by5ub3JtID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLl9ub3JtID09IG51bGwpIHtcbiAgICB2YXIgbSA9IHRoaXMuX21hcCxcbiAgICAgICAgcyA9IDAsIGs7XG4gICAgZm9yIChrIGluIG0pIHtcbiAgICAgIHMgKz0gbVtrXSAqIG1ba107XG4gICAgfVxuICAgIHRoaXMuX25vcm0gPSBNYXRoLnNxcnQocyk7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX25vcm07XG59O1xuXG4vLyBEb3QgcHJvZHVjdCB3aXRoIGFub3RoZXIgbi1ncmFtIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggc2hvdWxkIGhhdmUgdGhlIHNhbWUgKm4qIHBhcmFtZXRlci5cbnByb3RvLmRvdCA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgdmFyIGEgPSB0aGlzLl9tYXAsXG4gICAgICBiID0gdGhhdC5fbWFwLFxuICAgICAgZG90ID0gMCwgaztcblxuICBmb3IgKGsgaW4gYSkge1xuICAgIGRvdCArPSBhW2tdICogKGJba10gfHwgMCk7XG4gIH1cbiAgXG4gIHJldHVybiBkb3Q7XG59O1xuXG4vLyBDb3NpbmUgc2ltaWxhcml0eSB3aXRoIGFub3RoZXIgbi1ncmFtIHNrZXRjaC5cbi8vIFRoZSBpbnB1dCBza2V0Y2ggc2hvdWxkIGhhdmUgdGhlIHNhbWUgKm4qIHBhcmFtZXRlci5cbnByb3RvLmNvc2luZSA9IGZ1bmN0aW9uKHRoYXQpIHtcbiAgdmFyIGFhID0gdGhpcy5ub3JtKCksXG4gICAgICBiYiA9IHRoYXQubm9ybSgpO1xuICByZXR1cm4gKGFhICYmIGJiKSA/IHRoaXMuZG90KHRoYXQpIC8gKGFhICogYmIpIDogMDtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBza2V0Y2guXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICBuOiB0aGlzLl9uLFxuICAgIGNhc2U6IHRoaXMuX2Nhc2UsXG4gICAgY291bnRzOiB0aGlzLl9tYXBcbiAgfTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gTkdyYW07XG4iLCJ2YXIgREVGQVVMVF9DT1VOVEVSUyA9IDEwMDtcblxuLy8gQ3JlYXRlIGEgbmV3IHN0cmVhbSBzdW1tYXJ5IHNrZXRjaCBmb3IgdHJhY2tpbmcgZnJlcXVlbnQgdmFsdWVzLlxuLy8gU2VlOiAnRWZmaWNpZW50IENvbXB1dGF0aW9uIG9mIEZyZXF1ZW50IGFuZCBUb3AtayBFbGVtZW50cyBpbiBEYXRhIFN0cmVhbXMnXG4vLyBieSBBLiBNZXR3YWxseSwgRC4gQWdyYXdhbCAmIEEuIEVsIEFiYmFkaS5cbi8vIEFyZ3VtZW50ICp3KiBzcGVjaWZpZXMgdGhlIG1heGltdW0gbnVtYmVyIG9mIGFjdGl2ZSBjb3VudGVycyB0byBtYWludGFpbi5cbi8vIElmIG5vdCBwcm92aWRlZCwgKncqIGRlZmF1bHRzIHRvIHRyYWNraW5nIGEgbWF4aW11bSBvZiAxMDAgdmFsdWVzLlxuZnVuY3Rpb24gU3RyZWFtU3VtbWFyeSh3KSB7XG4gIHRoaXMuX3cgPSB3IHx8IERFRkFVTFRfQ09VTlRFUlM7XG4gIHRoaXMuX3ZhbHVlcyA9IHt9O1xuXG4gIHRoaXMuX2J1Y2tldHMgPSB7Y291bnQ6IC0xfTtcbiAgdGhpcy5fYnVja2V0cy5uZXh0ID0gdGhpcy5fYnVja2V0cztcbiAgdGhpcy5fYnVja2V0cy5wcmV2ID0gdGhpcy5fYnVja2V0cztcblxuICB0aGlzLl9zaXplID0gMDtcbn1cblxuLy8gQ3JlYXRlIGEgbmV3IFN0cmVhbVN1bW1hcnkgc2tldGNoIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdC5cblN0cmVhbVN1bW1hcnkuaW1wb3J0ID0gZnVuY3Rpb24ob2JqKSB7XG4gIHZhciBzcyA9IG5ldyBTdHJlYW1TdW1tYXJ5KG9iai53KSxcbiAgICAgIGJiID0gc3MuX2J1Y2tldHMsXG4gICAgICBpLCBuLCBjLCBiLCBqLCBtLCBlO1xuXG4gIGZvciAoaT0wLCBuPW9iai5idWNrZXRzLmxlbmd0aDsgaTxuOyArK2kpIHtcbiAgICBjID0gb2JqLmJ1Y2tldHNbaV07XG4gICAgYiA9IGluc2VydChiYi5wcmV2LCBidWNrZXQoY1swXSkpO1xuICAgIGZvciAoaj0xLCBtPWMubGVuZ3RoOyBqPG07IGorPTIpIHtcbiAgICAgIGUgPSBpbnNlcnQoYi5saXN0LnByZXYsIGVudHJ5KGNbal0sIGIpKTtcbiAgICAgIGUuY291bnQgPSBiLmNvdW50O1xuICAgICAgZS5lcnJvciA9IGNbaisxXTtcbiAgICAgIHNzLl9zaXplICs9IDE7XG4gICAgfVxuICB9XG4gIFxuICByZXR1cm4gc3M7XG59O1xuXG4vLyBHZW5lcmF0ZSBhIG5ldyBmcmVxdWVuY3kgYnVja2V0LlxuZnVuY3Rpb24gYnVja2V0KGNvdW50KSB7XG4gIHZhciBiID0ge2NvdW50OiBjb3VudH07XG4gIGIubmV4dCA9IGI7XG4gIGIucHJldiA9IGI7XG4gIGIubGlzdCA9IHt9O1xuICBiLmxpc3QucHJldiA9IGIubGlzdDtcbiAgYi5saXN0Lm5leHQgPSBiLmxpc3Q7XG4gIHJldHVybiBiO1xufVxuXG4vLyBHZW5lcmF0ZSBhIG5ldyBjb3VudGVyIG5vZGUgZm9yIGEgdmFsdWUuXG5mdW5jdGlvbiBlbnRyeSh2YWx1ZSwgYnVja2V0KSB7XG4gIHJldHVybiB7XG4gICAgYnVja2V0OiBidWNrZXQsXG4gICAgdmFsdWU6IHZhbHVlLFxuICAgIGNvdW50OiAwLFxuICAgIGVycm9yOiAwXG4gIH07XG59XG5cbi8vIEluc2VydCAqY3VyciogYWhlYWQgb2YgbGlua2VkIGxpc3Qgbm9kZSAqbGlzdCouXG5mdW5jdGlvbiBpbnNlcnQobGlzdCwgY3Vycikge1xuICB2YXIgbmV4dCA9IGxpc3QubmV4dDtcbiAgY3Vyci5uZXh0ID0gbmV4dDtcbiAgY3Vyci5wcmV2ID0gbGlzdDtcbiAgbGlzdC5uZXh0ID0gY3VycjtcbiAgbmV4dC5wcmV2ID0gY3VycjtcbiAgcmV0dXJuIGN1cnI7XG59XG5cbi8vIERldGFjaCAqY3VyciogZnJvbSBpdHMgbGlua2VkIGxpc3QuXG5mdW5jdGlvbiBkZXRhY2goY3Vycikge1xuICB2YXIgbiA9IGN1cnIubmV4dCxcbiAgICAgIHAgPSBjdXJyLnByZXY7XG4gIHAubmV4dCA9IG47XG4gIG4ucHJldiA9IHA7XG59XG5cbnZhciBwcm90byA9IFN0cmVhbVN1bW1hcnkucHJvdG90eXBlO1xuXG4vLyBBZGQgYSB2YWx1ZSB0byB0aGUgc2tldGNoLlxuLy8gQXJndW1lbnQgKnYqIGlzIHRoZSB2YWx1ZSB0byBhZGQuXG4vLyBBcmd1bWVudCAqY291bnQqIGlzIHRoZSBvcHRpb25hbCBudW1iZXIgb2Ygb2NjdXJyZW5jZXMgdG8gcmVnaXN0ZXIuXG4vLyBJZiAqY291bnQqIGlzIG5vdCBwcm92aWRlZCwgYW4gaW5jcmVtZW50IG9mIDEgaXMgYXNzdW1lZC5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYsIGNvdW50KSB7XG4gIGNvdW50ID0gY291bnQgfHwgMTtcbiAgdmFyIG5vZGUgPSB0aGlzLl92YWx1ZXNbdl0sIGI7XG5cbiAgaWYgKG5vZGUgPT0gbnVsbCkge1xuICAgIGlmICh0aGlzLl9zaXplIDwgdGhpcy5fdykge1xuICAgICAgYiA9IGluc2VydCh0aGlzLl9idWNrZXRzLCBidWNrZXQoMCkpO1xuICAgICAgbm9kZSA9IGluc2VydChiLmxpc3QsIGVudHJ5KHYsIGIpKTtcbiAgICAgIHRoaXMuX3NpemUgKz0gMTtcbiAgICB9IGVsc2Uge1xuICAgICAgYiA9IHRoaXMuX2J1Y2tldHMubmV4dDtcbiAgICAgIG5vZGUgPSBiLmxpc3QubmV4dDtcbiAgICAgIGRlbGV0ZSB0aGlzLl92YWx1ZXNbbm9kZS52YWx1ZV07XG4gICAgICBub2RlLnZhbHVlID0gdjtcbiAgICAgIG5vZGUuZXJyb3IgPSBiLmNvdW50O1xuICAgIH1cbiAgICB0aGlzLl92YWx1ZXNbdl0gPSBub2RlOyAgICBcbiAgfVxuICB0aGlzLl9pbmNyZW1lbnQobm9kZSwgY291bnQpO1xufTtcblxuLy8gSW5jcmVtZW50IHRoZSBjb3VudCBpbiB0aGUgc3RyZWFtIHN1bW1hcnkgZGF0YSBzdHJ1Y3R1cmUuXG5wcm90by5faW5jcmVtZW50ID0gZnVuY3Rpb24obm9kZSwgY291bnQpIHtcbiAgdmFyIGhlYWQgPSB0aGlzLl9idWNrZXRzLFxuICAgICAgb2xkICA9IG5vZGUuYnVja2V0LFxuICAgICAgcHJldiA9IG9sZCxcbiAgICAgIG5leHQgPSBwcmV2Lm5leHQ7XG5cbiAgZGV0YWNoKG5vZGUpO1xuICBub2RlLmNvdW50ICs9IGNvdW50O1xuXG4gIHdoaWxlIChuZXh0ICE9PSBoZWFkKSB7XG4gICAgaWYgKG5vZGUuY291bnQgPT09IG5leHQuY291bnQpIHtcbiAgICAgIGluc2VydChuZXh0Lmxpc3QsIG5vZGUpO1xuICAgICAgYnJlYWs7XG4gICAgfSBlbHNlIGlmIChub2RlLmNvdW50ID4gbmV4dC5jb3VudCkge1xuICAgICAgcHJldiA9IG5leHQ7XG4gICAgICBuZXh0ID0gcHJldi5uZXh0O1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXh0ID0gaGVhZDtcbiAgICB9XG4gIH1cblxuICBpZiAobmV4dCA9PT0gaGVhZCkge1xuICAgIG5leHQgPSBidWNrZXQobm9kZS5jb3VudCk7XG4gICAgaW5zZXJ0KG5leHQubGlzdCwgbm9kZSk7IC8vIGFkZCB2YWx1ZSBub2RlIHRvIGJ1Y2tldFxuICAgIGluc2VydChwcmV2LCBuZXh0KTsgIC8vIGFkZCBidWNrZXQgdG8gYnVja2V0IGxpc3RcbiAgfVxuICBub2RlLmJ1Y2tldCA9IG5leHQ7XG5cbiAgLy8gY2xlYW4gdXAgaWYgb2xkIGJ1Y2tldCBpcyBlbXB0eVxuICBpZiAob2xkLmxpc3QubmV4dCA9PT0gb2xkLmxpc3QpIHtcbiAgICBkZXRhY2gob2xkKTtcbiAgfVxufTtcblxuLy8gUXVlcnkgZm9yIGFwcHJveGltYXRlIGNvdW50IGZvciB2YWx1ZSAqdiouXG4vLyBSZXR1cm5zIHplcm8gaWYgKnYqIGlzIG5vdCBpbiB0aGUgc2tldGNoLlxucHJvdG8ucXVlcnkgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBub2RlID0gdGhpcy5fdmFsdWVzW3ZdO1xuICByZXR1cm4gbm9kZSA/IG5vZGUuY291bnQgOiAwO1xufTtcblxuLy8gUXVlcnkgZm9yIGVzdGltYXRpb24gZXJyb3IgZm9yIHZhbHVlICp2Ki5cbi8vIFJldHVybnMgLTEgaWYgKnYqIGlzIG5vdCBpbiB0aGUgc2tldGNoLlxucHJvdG8uZXJyb3IgPSBmdW5jdGlvbih2KSB7XG4gIHZhciBub2RlID0gdGhpcy5fdmFsdWVzW3ZdO1xuICByZXR1cm4gbm9kZSA/IG5vZGUuZXJyb3IgOiAtMTtcbn07XG5cbi8vIFJldHVybnMgdGhlIChhcHByb3hpbWF0ZSkgdG9wLWsgbW9zdCBmcmVxdWVudCB2YWx1ZXMsXG4vLyByZXR1cm5lZCBpbiBvcmRlciBvZiBkZWNyZWFzaW5nIGZyZXF1ZW5jeS5cbi8vIEFsbCBtb25pdG9yZWQgdmFsdWVzIGFyZSByZXR1cm5lZCBpZiAqayogaXMgbm90IHByb3ZpZGVkXG4vLyBvciBpcyBsYXJnZXIgdGhhbiB0aGUgc2tldGNoIHNpemUuXG5wcm90by52YWx1ZXMgPSBmdW5jdGlvbihrKSB7XG4gIHJldHVybiB0aGlzLmNvbGxlY3QoaywgZnVuY3Rpb24oeCkgeyByZXR1cm4geC52YWx1ZTsgfSk7XG59O1xuXG4vLyBSZXR1cm5zIGNvdW50cyBmb3IgdGhlIChhcHByb3hpbWF0ZSkgdG9wLWsgZnJlcXVlbnQgdmFsdWVzLFxuLy8gcmV0dXJuZWQgaW4gb3JkZXIgb2YgZGVjcmVhc2luZyBmcmVxdWVuY3kuXG4vLyBBbGwgbW9uaXRvcmVkIGNvdW50cyBhcmUgcmV0dXJuZWQgaWYgKmsqIGlzIG5vdCBwcm92aWRlZFxuLy8gb3IgaXMgbGFyZ2VyIHRoYW4gdGhlIHNrZXRjaCBzaXplLlxucHJvdG8uY291bnRzID0gZnVuY3Rpb24oaykge1xuICByZXR1cm4gdGhpcy5jb2xsZWN0KGssIGZ1bmN0aW9uKHgpIHsgcmV0dXJuIHguY291bnQ7IH0pO1xufTtcblxuLy8gUmV0dXJucyBlc3RpbWF0aW9uIGVycm9yIHZhbHVlcyBmb3IgdGhlIChhcHByb3hpbWF0ZSkgdG9wLWtcbi8vIGZyZXF1ZW50IHZhbHVlcywgcmV0dXJuZWQgaW4gb3JkZXIgb2YgZGVjcmVhc2luZyBmcmVxdWVuY3kuXG4vLyBBbGwgbW9uaXRvcmVkIGNvdW50cyBhcmUgcmV0dXJuZWQgaWYgKmsqIGlzIG5vdCBwcm92aWRlZFxuLy8gb3IgaXMgbGFyZ2VyIHRoYW4gdGhlIHNrZXRjaCBzaXplLlxucHJvdG8uZXJyb3JzID0gZnVuY3Rpb24oaykge1xuICByZXR1cm4gdGhpcy5jb2xsZWN0KGssIGZ1bmN0aW9uKHgpIHsgcmV0dXJuIHguZXJyb3I7IH0pO1xufTtcblxuLy8gQ29sbGVjdHMgdmFsdWVzIGZvciBlYWNoIGVudHJ5IGluIHRoZSBza2V0Y2gsIGluIG9yZGVyIG9mXG4vLyBkZWNyZWFzaW5nIChhcHByb3hpbWF0ZSkgZnJlcXVlbmN5LlxuLy8gQXJndW1lbnQgKmsqIGlzIHRoZSBudW1iZXIgb2YgdmFsdWVzIHRvIGNvbGxlY3QuIElmIHRoZSAqayogaXMgbm90XG4vLyBwcm92aWRlZCBvciBncmVhdGVyIHRoYW4gdGhlIHNrZXRjaCBzaXplLCBhbGwgdmFsdWVzIGFyZSB2aXNpdGVkLlxuLy8gQXJndW1lbnQgKmYqIGlzIGFuIGFjY2Vzc29yIGZ1bmN0aW9uIGZvciBjb2xsZWN0aW5nIGEgdmFsdWUuXG5wcm90by5jb2xsZWN0ID0gZnVuY3Rpb24oaywgZikge1xuICBpZiAoayA9PT0gMCkgcmV0dXJuIFtdO1xuICBpZiAoayA9PSBudWxsIHx8IGsgPCAwKSBrID0gdGhpcy5fc2l6ZTtcblxuICB2YXIgZGF0YSA9IEFycmF5KGspLFxuICAgICAgaGVhZCA9IHRoaXMuX2J1Y2tldHMsXG4gICAgICBub2RlLCBsaXN0LCBlbnRyeSwgaT0wO1xuXG4gIGZvciAobm9kZSA9IGhlYWQucHJldjsgbm9kZSAhPT0gaGVhZDsgbm9kZSA9IG5vZGUucHJldikge1xuICAgIGxpc3QgPSBub2RlLmxpc3Q7XG4gICAgZm9yIChlbnRyeSA9IGxpc3QucHJldjsgZW50cnkgIT09IGxpc3Q7IGVudHJ5ID0gZW50cnkucHJldikge1xuICAgICAgZGF0YVtpKytdID0gZihlbnRyeSk7XG4gICAgICBpZiAoaSA9PT0gaykgcmV0dXJuIGRhdGE7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRhdGE7XG59O1xuXG4vLyBSZXR1cm4gYSBKU09OLWNvbXBhdGlibGUgc2VyaWFsaXplZCB2ZXJzaW9uIG9mIHRoaXMgc2tldGNoLlxucHJvdG8uZXhwb3J0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBoZWFkID0gdGhpcy5fYnVja2V0cyxcbiAgICAgIG91dCA9IFtdLCBiLCBuLCBjO1xuXG4gIGZvciAoYiA9IGhlYWQubmV4dDsgYiAhPT0gaGVhZDsgYiA9IGIubmV4dCkge1xuICAgIGZvciAoYyA9IFtiLmNvdW50XSwgbiA9IGIubGlzdC5uZXh0OyBuICE9PSBiLmxpc3Q7IG4gPSBuLm5leHQpIHtcbiAgICAgIGMucHVzaChuLnZhbHVlLCBuLmVycm9yKTtcbiAgICB9XG4gICAgb3V0LnB1c2goYyk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHc6IHRoaXMuX3csXG4gICAgYnVja2V0czogb3V0XG4gIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmVhbVN1bW1hcnk7XG4iLCJ2YXIgVFlQRURfQVJSQVlTID0gdHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyxcbiAgICBFUFNJTE9OID0gMWUtMzAwLFxuICAgIERFRkFVTFRfQ09NUFJFU1MgPSAxMDA7XG5cbi8vIENyZWF0ZSBhIG5ldyB0LWRpZ2VzdCBza2V0Y2ggZm9yIHF1YW50aWxlIGFuZCBoaXN0b2dyYW0gZXN0aW1hdGlvbi5cbi8vIFNlZTogJ0NvbXB1dGluZyBFeHRyZW1lbHkgQWNjdXJhdGUgUXVhbnRpbGVzIHVzaW5nIHQtRGlnZXN0cydcbi8vIGJ5IFQuIER1bm5pbmcgJiBPLiBFcnRsLlxuLy8gQmFzZWQgb24gdGhlIFRlZCBEdW5uaW5nJ3MgbWVyZ2luZyBkaWdlc3QgaW1wbGVtZW50YXRpb24gYXQ6XG4vLyBodHRwczovL2dpdGh1Yi5jb20vdGR1bm5pbmcvdC1kaWdlc3Rcbi8vIEFyZ3VtZW50ICpjb21wcmVzcyogaXMgdGhlIGNvbXByZXNzaW9uIGZhY3RvciwgZGVmYXVsdHMgdG8gMTAwLCBtYXggMTAwMC5cbmZ1bmN0aW9uIFREaWdlc3QoY29tcHJlc3MpIHtcbiAgdmFyIGNmID0gY29tcHJlc3MgfHwgREVGQVVMVF9DT01QUkVTUywgdGVtcHNpemUsIHNpemU7XG4gIGNmID0gY2YgPCAyMCA/IDIwIDogY2YgPiAxMDAwID8gMTAwMDogY2Y7XG4gIC8vIG1hZ2ljIGZvcm11bGEgZnJvbSByZWdyZXNzaW5nIGFnYWluc3Qga25vd24gc2l6ZXMgZm9yIHNhbXBsZSBjZidzXG4gIHRlbXBzaXplID0gfn4oNy41ICsgMC4zNypjZiAtIDJlLTQqY2YqY2YpO1xuICAvLyBzaG91bGQgb25seSBuZWVkIGNlaWwoY2YgKiBQSSAvIDIpLCBkb3VibGUgYWxsb2NhdGlvbiBmb3Igc2FmZXR5XG4gIHNpemUgPSBNYXRoLmNlaWwoTWF0aC5QSSAqIGNmKTtcblxuICB0aGlzLl9jZiA9IGNmOyAvLyBjb21wcmVzc2lvbiBmYWN0b3JcblxuICB0aGlzLl90b3RhbFN1bSA9IDA7XG4gIHRoaXMuX2xhc3QgPSAwO1xuICB0aGlzLl93ZWlnaHQgPSBudW1BcnJheShzaXplKTtcbiAgdGhpcy5fbWVhbiA9IG51bUFycmF5KHNpemUpO1xuICB0aGlzLl9taW4gPSBOdW1iZXIuTUFYX1ZBTFVFO1xuICB0aGlzLl9tYXggPSAtTnVtYmVyLk1BWF9WQUxVRTtcblxuICB0aGlzLl91bm1lcmdlZFN1bSA9IDA7XG4gIHRoaXMuX21lcmdlV2VpZ2h0ID0gbnVtQXJyYXkoc2l6ZSk7XG4gIHRoaXMuX21lcmdlTWVhbiA9IG51bUFycmF5KHNpemUpO1xuXG4gIHRoaXMuX3RlbXBMYXN0ID0gMDtcbiAgdGhpcy5fdGVtcFdlaWdodCA9IG51bUFycmF5KHRlbXBzaXplKTtcbiAgdGhpcy5fdGVtcE1lYW4gPSBudW1BcnJheSh0ZW1wc2l6ZSk7XG4gIHRoaXMuX29yZGVyID0gW107XG59XG5cbmZ1bmN0aW9uIG51bUFycmF5KHNpemUpIHtcbiAgcmV0dXJuIFRZUEVEX0FSUkFZUyA/IG5ldyBGbG9hdDY0QXJyYXkoc2l6ZSkgOiBBcnJheShzaXplKTtcbn1cblxuZnVuY3Rpb24gaW50ZWdyYXRlKGNmLCBxKSB7XG4gIHJldHVybiBjZiAqIChNYXRoLmFzaW4oMiAqIHEgLSAxKSArIE1hdGguUEkgLyAyKSAvIE1hdGguUEk7XG59XG5cbmZ1bmN0aW9uIGludGVycG9sYXRlKHgsIHgwLCB4MSkge1xuICByZXR1cm4gKHggLSB4MCkgLyAoeDEgLSB4MCk7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyB0LWRpZ2VzdCBza2V0Y2ggZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0LlxuVERpZ2VzdC5pbXBvcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgdmFyIHRkID0gbmV3IFREaWdlc3Qob2JqLmNvbXByZXNzKTtcbiAgdmFyIHN1bSA9IDA7XG4gIHRkLl9taW4gPSBvYmoubWluO1xuICB0ZC5fbWF4ID0gb2JqLm1heDtcbiAgdGQuX2xhc3QgPSBvYmoubWVhbi5sZW5ndGggLSAxO1xuICBmb3IgKHZhciBpPTAsIG49b2JqLm1lYW4ubGVuZ3RoOyBpPG47ICsraSkge1xuICAgIHRkLl9tZWFuW2ldID0gb2JqLm1lYW5baV07XG4gICAgc3VtICs9ICh0ZC5fd2VpZ2h0W2ldID0gb2JqLndlaWdodFtpXSk7XG4gIH1cbiAgdGQuX3RvdGFsU3VtID0gc3VtO1xuICByZXR1cm4gdGQ7XG59O1xuXG52YXIgcHJvdG8gPSBURGlnZXN0LnByb3RvdHlwZTtcblxuLy8gQWRkIGEgdmFsdWUgdG8gdGhlIHQtZGlnZXN0LlxuLy8gQXJndW1lbnQgKnYqIGlzIHRoZSB2YWx1ZSB0byBhZGQuXG4vLyBBcmd1bWVudCAqY291bnQqIGlzIHRoZSBpbnRlZ2VyIG51bWJlciBvZiBvY2N1cnJlbmNlcyB0byBhZGQuXG4vLyBJZiBub3QgcHJvdmlkZWQsICpjb3VudCogZGVmYXVsdHMgdG8gMS5cbnByb3RvLmFkZCA9IGZ1bmN0aW9uKHYsIGNvdW50KSB7XG4gIGlmICh2ID09IG51bGwgfHwgdiAhPT0gdikgcmV0dXJuOyAvLyBpZ25vcmUgbnVsbCwgTmFOXG4gIGNvdW50ID0gY291bnQgfHwgMTtcbiAgXG4gIGlmICh0aGlzLl90ZW1wTGFzdCA+PSB0aGlzLl90ZW1wV2VpZ2h0Lmxlbmd0aCkge1xuICAgIHRoaXMuX21lcmdlVmFsdWVzKCk7XG4gIH1cblxuICB2YXIgbiA9IHRoaXMuX3RlbXBMYXN0Kys7XG4gIHRoaXMuX3RlbXBXZWlnaHRbbl0gPSBjb3VudDtcbiAgdGhpcy5fdGVtcE1lYW5bbl0gPSB2O1xuICB0aGlzLl91bm1lcmdlZFN1bSArPSBjb3VudDtcbn07XG5cbnByb3RvLl9tZXJnZVZhbHVlcyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5fdW5tZXJnZWRTdW0gPT09IDApIHJldHVybjtcblxuICB2YXIgdHcgPSB0aGlzLl90ZW1wV2VpZ2h0LFxuICAgICAgdHUgPSB0aGlzLl90ZW1wTWVhbixcbiAgICAgIHRuID0gdGhpcy5fdGVtcExhc3QsXG4gICAgICB3ID0gdGhpcy5fd2VpZ2h0LFxuICAgICAgdSA9IHRoaXMuX21lYW4sXG4gICAgICBuID0gMCxcbiAgICAgIG9yZGVyID0gdGhpcy5fb3JkZXIsXG4gICAgICBzdW0gPSAwLCBpaSwgaSwgaiwgazE7XG5cbiAgLy8gZ2V0IHNvcnQgb3JkZXIgZm9yIHRlbXAgdmFsdWVzXG4gIG9yZGVyLmxlbmd0aCA9IHRuO1xuICBmb3IgKGk9MDsgaTx0bjsgKytpKSBvcmRlcltpXSA9IGk7XG4gIG9yZGVyLnNvcnQoZnVuY3Rpb24oYSxiKSB7IHJldHVybiB0dVthXSAtIHR1W2JdOyB9KTtcblxuICBpZiAodGhpcy5fdG90YWxTdW0gPiAwKSB7XG4gICAgaWYgKHdbdGhpcy5fbGFzdF0gPiAwKSB7XG4gICAgICBuID0gdGhpcy5fbGFzdCArIDE7XG4gICAgfSBlbHNlIHtcbiAgICAgIG4gPSB0aGlzLl9sYXN0O1xuICAgIH1cbiAgfVxuICB0aGlzLl9sYXN0ID0gMDtcbiAgdGhpcy5fdG90YWxTdW0gKz0gdGhpcy5fdW5tZXJnZWRTdW07XG4gIHRoaXMuX3VubWVyZ2VkU3VtID0gMDtcblxuICAvLyBtZXJnZSB0ZW1wV2VpZ2h0LHRlbXBNZWFuIGFuZCB3ZWlnaHQsbWVhbiBpbnRvIG1lcmdlV2VpZ2h0LG1lcmdlTWVhblxuICBmb3IgKGk9aj1rMT0wOyBpIDwgdG4gJiYgaiA8IG47KSB7XG4gICAgaWkgPSBvcmRlcltpXTtcbiAgICBpZiAodHVbaWldIDw9IHVbal0pIHtcbiAgICAgIHN1bSArPSB0d1tpaV07XG4gICAgICBrMSA9IHRoaXMuX21lcmdlQ2VudHJvaWQoc3VtLCBrMSwgdHdbaWldLCB0dVtpaV0pO1xuICAgICAgaSsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBzdW0gKz0gd1tqXTtcbiAgICAgIGsxID0gdGhpcy5fbWVyZ2VDZW50cm9pZChzdW0sIGsxLCB3W2pdLCB1W2pdKTtcbiAgICAgIGorKztcbiAgICB9XG4gIH1cbiAgZm9yICg7IGkgPCB0bjsgKytpKSB7XG4gICAgaWkgPSBvcmRlcltpXTtcbiAgICBzdW0gKz0gdHdbaWldO1xuICAgIGsxID0gdGhpcy5fbWVyZ2VDZW50cm9pZChzdW0sIGsxLCB0d1tpaV0sIHR1W2lpXSk7XG4gIH1cbiAgZm9yICg7IGogPCBuOyArK2opIHtcbiAgICBzdW0gKz0gd1tqXTtcbiAgICBrMSA9IHRoaXMuX21lcmdlQ2VudHJvaWQoc3VtLCBrMSwgd1tqXSwgdVtqXSk7XG4gIH1cbiAgdGhpcy5fdGVtcExhc3QgPSAwO1xuXG4gIC8vIHN3YXAgcG9pbnRlcnMgZm9yIHdvcmtpbmcgc3BhY2UgYW5kIG1lcmdlIHNwYWNlXG4gIHRoaXMuX3dlaWdodCA9IHRoaXMuX21lcmdlV2VpZ2h0O1xuICB0aGlzLl9tZXJnZVdlaWdodCA9IHc7XG4gIGZvciAoaT0wLCBuPXcubGVuZ3RoOyBpPG47ICsraSkgd1tpXSA9IDA7XG5cbiAgdGhpcy5fbWVhbiA9IHRoaXMuX21lcmdlTWVhbjtcbiAgdGhpcy5fbWVyZ2VNZWFuID0gdTtcblxuICBpZiAodGhpcy5fd2VpZ2h0W24gPSB0aGlzLl9sYXN0XSA8PSAwKSAtLW47XG4gIHRoaXMuX21pbiA9IE1hdGgubWluKHRoaXMuX21pbiwgdGhpcy5fbWVhblswXSk7XG4gIHRoaXMuX21heCA9IE1hdGgubWF4KHRoaXMuX21heCwgdGhpcy5fbWVhbltuXSk7XG59O1xuXG5wcm90by5fbWVyZ2VDZW50cm9pZCA9IGZ1bmN0aW9uKHN1bSwgazEsIHd0LCB1dCkge1xuICB2YXIgdyA9IHRoaXMuX21lcmdlV2VpZ2h0LFxuICAgICAgdSA9IHRoaXMuX21lcmdlTWVhbixcbiAgICAgIG4gPSB0aGlzLl9sYXN0LFxuICAgICAgazIgPSBpbnRlZ3JhdGUodGhpcy5fY2YsIHN1bSAvIHRoaXMuX3RvdGFsU3VtKTtcblxuICBpZiAoazIgLSBrMSA8PSAxIHx8IHdbbl0gPT09IDApIHtcbiAgICAvLyBtZXJnZSBpbnRvIGV4aXN0aW5nIGNlbnRyb2lkXG4gICAgd1tuXSArPSB3dDtcbiAgICB1W25dID0gdVtuXSArICh1dCAtIHVbbl0pICogd3QgLyB3W25dO1xuICB9IGVsc2Uge1xuICAgIC8vIGNyZWF0ZSBuZXcgY2VudHJvaWRcbiAgICB0aGlzLl9sYXN0ID0gKytuO1xuICAgIHVbbl0gPSB1dDtcbiAgICB3W25dID0gd3Q7XG4gICAgazEgPSBpbnRlZ3JhdGUodGhpcy5fY2YsIChzdW0gLSB3dCkgLyB0aGlzLl90b3RhbFN1bSk7XG4gIH1cblxuICByZXR1cm4gazE7XG59O1xuXG4vLyBUaGUgbnVtYmVyIG9mIHZhbHVlcyB0aGF0IGhhdmUgYmVlbiBhZGRlZCB0byB0aGlzIHNrZXRjaC5cbnByb3RvLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuX3RvdGFsU3VtICsgdGhpcy5fdW5tZXJnZWRTdW07XG59O1xuXG4vLyBRdWVyeSBmb3IgZXN0aW1hdGVkIHF1YW50aWxlICpxKi5cbi8vIEFyZ3VtZW50ICpxKiBpcyBhIGRlc2lyZWQgcXVhbnRpbGUgaW4gdGhlIHJhbmdlICgwLDEpXG4vLyBGb3IgZXhhbXBsZSwgcSA9IDAuNSBxdWVyaWVzIGZvciB0aGUgbWVkaWFuLlxucHJvdG8ucXVhbnRpbGUgPSBmdW5jdGlvbihxKSB7XG4gIHRoaXMuX21lcmdlVmFsdWVzKCk7XG4gIHEgPSBxICogdGhpcy5fdG90YWxTdW07XG5cbiAgdmFyIHcgPSB0aGlzLl93ZWlnaHQsXG4gICAgICB1ID0gdGhpcy5fbWVhbixcbiAgICAgIG4gPSB0aGlzLl9sYXN0LFxuICAgICAgbWF4ID0gdGhpcy5fbWF4LFxuICAgICAgdWEgPSB1WzBdLCB1YiwgLy8gbWVhbnNcbiAgICAgIHdhID0gd1swXSwgd2IsIC8vIHdlaWdodHNcbiAgICAgIGxlZnQgPSB0aGlzLl9taW4sIHJpZ2h0LFxuICAgICAgc3VtID0gMCwgcCwgaTtcblxuICBpZiAobiA9PT0gMCkgcmV0dXJuIHdbbl0gPT09IDAgPyBOYU4gOiB1WzBdO1xuICBpZiAod1tuXSA+IDApICsrbjtcblxuICBmb3IgKGk9MTsgaTxuOyArK2kpIHtcbiAgICB1YiA9IHVbaV07XG4gICAgd2IgPSB3W2ldO1xuICAgIHJpZ2h0ID0gKHdiICogdWEgKyB3YSAqIHViKSAvICh3YSArIHdiKTtcblxuICAgIGlmIChxIDwgc3VtICsgd2EpIHtcbiAgICAgIHAgPSAocSAtIHN1bSkgLyB3YTtcbiAgICAgIHJldHVybiBsZWZ0ICogKDEtcCkgKyByaWdodCAqIHA7XG4gICAgfVxuXG4gICAgc3VtICs9IHdhO1xuICAgIHVhID0gdWI7XG4gICAgd2EgPSB3YjtcbiAgICBsZWZ0ID0gcmlnaHQ7XG4gIH1cblxuICByaWdodCA9IG1heDtcbiAgaWYgKHEgPCBzdW0gKyB3YSkge1xuICAgIHAgPSAocSAtIHN1bSkgLyB3YTtcbiAgICByZXR1cm4gbGVmdCAqICgxLXApICsgcmlnaHQgKiBwO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBtYXg7XG4gIH1cbn07XG5cbi8vIFF1ZXJ5IGZvciBmcmFjdGlvbiBvZiB2YWx1ZXMgPD0gKnYqLlxucHJvdG8uY2RmID0gZnVuY3Rpb24odikge1xuICB0aGlzLl9tZXJnZVZhbHVlcygpO1xuXG4gIHZhciB0b3RhbCA9IHRoaXMuX3RvdGFsU3VtLFxuICAgICAgdyA9IHRoaXMuX3dlaWdodCxcbiAgICAgIHUgPSB0aGlzLl9tZWFuLFxuICAgICAgbiA9IHRoaXMuX2xhc3QsXG4gICAgICBtaW4gPSB0aGlzLl9taW4sXG4gICAgICBtYXggPSB0aGlzLl9tYXgsXG4gICAgICB1YSA9IG1pbiwgdWIsIC8vIG1lYW5zXG4gICAgICB3YSA9IDAsICAgd2IsIC8vIHdlaWdodHNcbiAgICAgIHN1bSA9IDAsIGxlZnQgPSAwLCByaWdodCwgaTtcblxuICBpZiAobiA9PT0gMCkge1xuICAgIHJldHVybiB3W25dID09PSAwID8gTmFOIDpcbiAgICAgIHYgPCBtaW4gPyAwIDpcbiAgICAgIHYgPiBtYXggPyAxIDpcbiAgICAgIChtYXggLSBtaW4gPCBFUFNJTE9OKSA/IDAuNSA6XG4gICAgICBpbnRlcnBvbGF0ZSh2LCBtaW4sIG1heCk7XG4gIH1cbiAgaWYgKHdbbl0gPiAwKSArK247XG5cbiAgLy8gZmluZCBlbmNsb3NpbmcgcGFpciBvZiBjZW50cm9pZHMgKHRyZWF0IG1pbiBhcyBhIHZpcnR1YWwgY2VudHJvaWQpXG4gIGZvciAoaT0wOyBpPG47ICsraSkge1xuICAgIHViID0gdVtpXTtcbiAgICB3YiA9IHdbaV07XG4gICAgcmlnaHQgPSAodWIgLSB1YSkgKiB3YSAvICh3YSArIHdiKTtcblxuICAgIC8vIHdlIGtub3cgdGhhdCB2ID49IHVhLWxlZnRcbiAgICBpZiAodiA8IHVhICsgcmlnaHQpIHtcbiAgICAgIHYgPSAoc3VtICsgd2EgKiBpbnRlcnBvbGF0ZSh2LCB1YS1sZWZ0LCB1YStyaWdodCkpIC8gdG90YWw7XG4gICAgICByZXR1cm4gdiA+IDAgPyB2IDogMDtcbiAgICB9XG5cbiAgICBzdW0gKz0gd2E7XG4gICAgbGVmdCA9IHViIC0gKHVhICsgcmlnaHQpO1xuICAgIHVhID0gdWI7XG4gICAgd2EgPSB3YjtcbiAgfVxuXG4gIC8vIGZvciB0aGUgbGFzdCBlbGVtZW50LCB1c2UgbWF4IHRvIGRldGVybWluZSByaWdodFxuICByaWdodCA9IG1heCAtIHVhO1xuICByZXR1cm4gICh2IDwgdWEgKyByaWdodCkgP1xuICAgIChzdW0gKyB3YSAqIGludGVycG9sYXRlKHYsIHVhLWxlZnQsIHVhK3JpZ2h0KSkgLyB0b3RhbCA6XG4gICAgMTtcbn07XG5cbi8vIFVuaW9uIHRoaXMgdC1kaWdlc3Qgd2l0aCBhbm90aGVyLlxucHJvdG8udW5pb24gPSBmdW5jdGlvbih0ZCkge1xuICB2YXIgdSA9IFREaWdlc3QuaW1wb3J0KHRoaXMuZXhwb3J0KCkpO1xuICB0ZC5fbWVyZ2VWYWx1ZXMoKTtcbiAgZm9yICh2YXIgaT0wLCBuPXRkLl9sYXN0OyBpPG47ICsraSkge1xuICAgIHUuYWRkKHRkLl9tZWFuW2ldLCB0ZC5fd2VpZ2h0W2ldKTtcbiAgfVxuICByZXR1cm4gdTtcbn07XG5cbi8vIFJldHVybiBhIEpTT04tY29tcGF0aWJsZSBzZXJpYWxpemVkIHZlcnNpb24gb2YgdGhpcyBza2V0Y2guXG5wcm90by5leHBvcnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fbWVyZ2VWYWx1ZXMoKTtcbiAgcmV0dXJuIHtcbiAgICBjb21wcmVzczogdGhpcy5fY2YsXG4gICAgbWluOiAgICAgIHRoaXMuX21pbixcbiAgICBtYXg6ICAgICAgdGhpcy5fbWF4LFxuICAgIG1lYW46ICAgICBbXS5zbGljZS5jYWxsKHRoaXMuX21lYW4sIDAsIHRoaXMuX2xhc3QrMSksXG4gICAgd2VpZ2h0OiAgIFtdLnNsaWNlLmNhbGwodGhpcy5fd2VpZ2h0LCAwLCB0aGlzLl9sYXN0KzEpXG4gIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFREaWdlc3Q7XG4iXX0=
