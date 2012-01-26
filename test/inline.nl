var assert = require('assert');

function go(cb) {
	res <- (function (cb) { cb(null, 'ye'); })();
	ult <- ((function (cb) { cb(null, 's'); })) ();
	return res + ult;
}

go(function (err, result) {
	assert.ifError(err);
	assert.equal(result, 'yes');
});
