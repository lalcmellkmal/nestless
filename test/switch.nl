var assert = require('assert');

function augment(x, y, cb) {
	cb(null, x * y + 1);
}

function branch(x, y, cb) {
	switch (x) {
		case 0:
			assert.ok(false);
		case 1:
		{
			z <- augment(y, 2);
			return z;
		}
		case 2:
		{
			z <- augment(y, 3);
			return z;
		}
			break;
		case 3:
			break;
		case 4:
		{
			z <- augment(y, 7);
			return z;
		}
		default:
		{
			z <- augment(y, 11);
			return z;
		}
	}
	z <- augment(y, 5);
	return z;
}

function fold(i, result) {
	branch(i, result, function (err, updated) {
		assert.ifError(err);
		if (i < 5)
			fold(i + 1, updated);
		else
			done(updated);
	});
}

var notDone = true;
function done(result) {
	assert.equal(notDone, true);
	assert.equal(result, (((((1*2+1)*3+1)*5+1)*7+1)*11+1));
	notDone = false;
}

fold(1, 1);
