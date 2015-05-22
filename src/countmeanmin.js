var CountMin = require('./CountMin');

function CountMeanMin(w, d) {
  CountMin.call(this, w, d);
  this._q = Array(d);
}

CountMeanMin.create = CountMin.create;

var proto = (CountMeanMin.prototype = Object.create(CountMin.prototype));

proto.query = function(value) {
  var l = this.locations(value),
      q = this._q,
      w = this._w,
      d = this._d,
      s = this._num / (w-1),
      t = this._table,
      c, i, H, h, v, e;

  for (i=0; i<d; ++i) {
    c = t[i*w + l[i]];
    q[i] = c - (s*c);
  }

  // Compute the median
  q.sort(numcmp);
  H = (d - 1) * 0.5 + 1;
  h = Math.floor(H);
  v = q[h-1];
  e = H - h;
  return e ? v + e * (q[h] - v) : v;
};

function numcmp(a, b) {
  return a - b;
}

module.exports = CountMeanMin;
