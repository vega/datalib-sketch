var DEFAULT_COUNTERS = 200;

// Create a new stream summary sketch for tracking frequent values.
// See: 'Efficient Computation of Frequent and Top-k Elements in Data Streams'
// by A. Metwally, D. Agrawal & A. El Abbadi
// Argument *w* specifies the number of active counters to maintain.
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

function bucket(count) {
  var b = {count: count};
  b.next = b;
  b.prev = b;
  b.list = {};
  b.list.prev = b.list;
  b.list.next = b.list;
  return b;
}

function entry(value, bucket) {
  return {
    bucket: bucket,
    value: value,
    count: 0,
    error: 0
  };
}

function insert(list, curr) {
  var next = list.next;
  curr.next = next;
  curr.prev = list;
  list.next = curr;
  next.prev = curr;
  return curr;
}

function detach(curr) {
  var n = curr.next,
      p = curr.prev;
  p.next = n;
  n.prev = p;
}

var proto = StreamSummary.prototype;

// Add a value to the sketch.
proto.add = function(v, count) {
  count = count || 1;
  var node = this._values[v];
  if (node == null) {
    if (this._size < this._w) {
      var b = insert(this._buckets, bucket(0));
      node = insert(b.list, entry(v, b));
      this._size += 1;
    } else {
      var min = this._buckets.next;
      node = min.list.next;
      delete this._values[node.value];
      node.value = v;
      node.error = min.count;
    }
    this._values[v] = node;    
  }
  this.increment(node, count);
};

proto.increment = function(node, count) {
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

// TODO add method to extract top-k

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
