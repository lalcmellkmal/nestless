var assert = require('assert');

function augment(x, y, cb) {
	cb(null, x * y + 1);
}

function branch(x, y, cb) {
	if (x <= 3) {
		if (x <= 2) {
			if (x <= 1) {
				z <- augment(y, 2);
				return z;
			}
			z <- augment(y, 3);
			return z;
		}
		else {
			z <- augment(y, 5);
			return z;
		}
	}
	else {
		if (x >= 6) {
			z <- augment(y, 13);
			return z;
		}

		if (x == 5) {
			z <- augment(y, 11);
			return z;
		}
	}
	z <- augment(y, 7);
	return z;
}

function fold(i, result) {
	branch(i, result, function (err, updated) {
		assert.ifError(err);
		if (i < 6)
			fold(i + 1, updated);
		else
			done(updated);
	});
}

var notDone = true;
function done(result) {
	assert.equal(notDone, true);
	assert.equal(result, ((((((1*2+1)*3+1)*5+1)*7+1)*11+1)*13+1));
	notDone = false;
}

fold(1, 1);
