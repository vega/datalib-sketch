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
