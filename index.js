'use strict';

var t = require('tcomb');

var ValidationError = t.struct({
  message: t.Str,
  actual: t.Any,
  expected: t.Any,
  path: t.list(t.union([t.Str, t.Num]))
}, 'ValidationError');

function stringify(x) {
  try { // handle "Converting circular structure to JSON" error
    return JSON.stringify(x);
  } catch (e) {
    return String(x);
  }
}

function getDefaultMessage(actual, expected, path) {
  return '/' + path.join('/') + ' is ' + stringify(actual) + ' should be a ' + t.getTypeName(expected);
}

ValidationError.of = function of(actual, expected, path) {
  return new ValidationError({
    message: getDefaultMessage(actual, expected, path),
    actual: actual,
    expected: expected,
    path: path
  });
};

var ValidationResult = t.struct({
  errors: t.list(ValidationError),
  value: t.Any
}, 'ValidationResult');

ValidationResult.prototype.isValid = function isValid() {
  return !(this.errors.length);
};

ValidationResult.prototype.firstError = function firstError() {
  return this.isValid() ? null : this.errors[0];
};

ValidationResult.prototype.toString = function toString() {
  return this.isValid() ?
    '[ValidationResult, true, ' + stringify(this.value) + ']' :
    '[ValidationResult, false, (' + this.errors.map(function errorToString(err) {
      return err.message;
    }).join(', ') + ')]';
};

function validate(x, type, path) {
  return new ValidationResult(recurse(x, type, path || []));
}

function recurse(x, type, path) {
  var validator = t.isType(type) ?
    type.meta.kind :
    'es6classes';
  return validators[validator](x, type, path);
}

var validators = validate.validators = {};

validators.es6classes = function validateES6Classes(x, type, path) {
  return {
    value: x,
    errors: x instanceof type ? [] : [ValidationError.of(x, type, path)]
  };
};

// irreducibles and enums
validators.irreducible =
validators.enums = function validateIrreducible(x, type, path) {
  return {
    value: x,
    errors: type.is(x) ? [] : [ValidationError.of(x, type, path)]
  };
};

validators.list = function validateList(x, type, path) {

  // x should be an array
  if (!t.Arr.is(x)) {
    return {value: x, errors: [ValidationError.of(x, type, path)]};
  }

  var ret = {value: [], errors: []};
  // every item should be of type `type.meta.type`
  for (var i = 0, len = x.length; i < len; i++ ) {
    var item = recurse(x[i], type.meta.type, path.concat(i));
    ret.value[i] = item.value;
    ret.errors = ret.errors.concat(item.errors);
  }
  return ret;
};

validators.subtype = function validateSubtype(x, type, path) {

  // x should be a valid inner type
  var ret = recurse(x, type.meta.type, path);
  if (ret.errors.length) {
    return ret;
  }

  // x should satisfy the predicate
  if (!type.meta.predicate(ret.value)) {
    ret.errors = [ValidationError.of(x, type, path)];
  }

  return ret;

};

validators.maybe = function validateMaybe(x, type, path) {
  return t.Nil.is(x) ?
    {value: null, errors: []} :
    recurse(x, type.meta.type, path);
};

validators.struct = function validateStruct(x, type, path) {

  // x should be an object
  if (!t.Obj.is(x)) {
    return {value: x, errors: [ValidationError.of(x, type, path)]};
  }

  // [optimization]
  if (type.is(x)) {
    return {value: x, errors: []};
  }

  var ret = {value: {}, errors: []};
  var props = type.meta.props;
  // every item should be of type `props[name]`
  for (var name in props) {
    if (props.hasOwnProperty(name)) {
      var prop = recurse(x[name], props[name], path.concat(name));
      ret.value[name] = prop.value;
      ret.errors = ret.errors.concat(prop.errors);
    }
  }
  if (!ret.errors.length) {
    ret.value = new type(ret.value);
  }
  return ret;
};

validators.tuple = function validateTuple(x, type, path) {

  var types = type.meta.types;
  var len = types.length;

  // x should be an array of at most `len` items
  if (!t.Arr.is(x) || x.length > len) {
    return {value: x, errors: [ValidationError.of(x, type, path)]};
  }

  var ret = {value: [], errors: []};
  // every item should be of type `types[i]`
  for (var i = 0; i < len; i++) {
    var item = recurse(x[i], types[i], path.concat(i));
    ret.value[i] = item.value;
    ret.errors = ret.errors.concat(item.errors);
  }
  return ret;
};

validators.dict = function validateDict(x, type, path) {

  // x should be an object
  if (!t.Obj.is(x)) {
    return {value: x, errors: [ValidationError.of(x, type, path)]};
  }

  var ret = {value: {}, errors: []};
  // every key should be of type `domain`
  // every value should be of type `codomain`
  for (var k in x) {
    if (x.hasOwnProperty(k)) {
      var subpath = path.concat(k);
      var key = recurse(k, type.meta.domain, subpath);
      var item = recurse(x[k], type.meta.codomain, subpath);
      ret.value[k] = item.value;
      ret.errors = ret.errors.concat(key.errors, item.errors);
    }
  }
  return ret;
};

validators.union = function validateUnion(x, type, path) {
  var ctor = type.dispatch(x);
  return t.Func.is(ctor) ?
    recurse(x, ctor, path.concat(type.meta.types.indexOf(ctor))) :
    {value: x, errors: [ValidationError.of(x, type, path)]};
};

t.mixin(t, {
  ValidationError: ValidationError,
  ValidationResult: ValidationResult,
  validate: validate
});

module.exports = t;
