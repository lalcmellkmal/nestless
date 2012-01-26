var assert = require('assert');

function zero(cb) { cb(null); }
function one(x, cb) { cb(null, x); }
function two(x, y, cb) { cb(null, x, y); }

function go(cb) {
	_ <- zero();
	a <- one(1);
	b, c <- two(2, 3);
	return a + b + c;
}

go(function (err, result) {
	assert.ifError(err);
	assert.equal(result, 6);
});
