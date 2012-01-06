/*
 * The Marionette object, passed to the script context.
 */

var Marionette = {
  is_async: false,
  tests: [],

  reset: function Marionette__reset() {
    Marionette.is_async = false;
    Marionette.tests = [];
  },

  ok: function Marionette__ok(condition, name, diag) {
    var test = {'result': !!condition, 'name': name, 'diag': diag};
    Marionette.logResult(test, "TEST-PASS", "TEST-UNEXPECTED-FAIL");
    Marionette.tests.push(test);
  },

  is: function Marionette__is(a, b, name) {
    var pass = (a == b);
    var diag = pass ? Marionette.repr(a) + " should equal " + Marionette.repr(b)
                    : "got " + Marionette.repr(a) + ", expected " + Marionette.repr(b)
    Marionette.ok(pass, name, diag);
  },

  isnot: function Marionette__isnot (a, b, name) {
      var pass = (a != b);
      var diag = pass ? Marionette.repr(a) + " should not equal " + Marionette.repr(b)
                      : "didn't expect " + Marionette.repr(a) + ", but got it";
      Marionette.ok(pass, name, diag);
  },

  generate_results: function Marionette__generate_results() {
    var passed = 0;
    var failed = 0;
    for (var i in Marionette.tests) {
      if(Marionette.tests[i].result) {
        passed++;
      }
      else {
        failed++;
      }
    }
    Marionette.reset();
    return {"passed": passed, "failed": failed, "marionette_object": true};
  },

  finish: function Marionette__finish() {
    if (Marionette.is_async) {
      if (Marionette.context == "content") {
        Marionette.asyncComplete(Marionette.generate_results(), 0);
      }
      else {
        Marionette.returnFunc(Marionette.generate_results(), 0);
      }
    }
    else {
      return Marionette.generate_results();
    }
  },

  returnFunc: function Marionette__returnFunc(value, status) {
    if (status == 0 || status == undefined) {
      Marionette.__conn.send({from: Marionette.__actorID, value: value, status: status});
    }
    else {
      var error_msg = {message: value, status: status, stacktrace: null};
      Marionette.__conn.send({from: Marionette.__actorID, error: error_msg});
    }
    Marionette.__timer.cancel();
    Marionette.__timer = null;
  },

  asyncComplete: function Marionette__async_completed(value, status) {
      var document = content.window.document;
      var __marionetteRes = document.getUserData('__marionetteRes');
      if(__marionetteRes.status == undefined) {
        __marionetteRes.value = value;
        __marionetteRes.status = status;
        document.setUserData('__marionetteRes', __marionetteRes, null);
        var ev = document.createEvent('Events');
        ev.initEvent('marionette-async-response', true, false);
        document.dispatchEvent(ev);
      }
    },

  logToFile: function Marionette__logToFile(file) {
    //TODO
  },

  logResult: function Marionette__logResult(test, passString, failString) {
    //TODO: dump to file
    var resultString = test.result ? passString : failString;
    var diagnostic = test.name + (test.diag ? " - " + test.diag : "");
    var msg = [resultString, diagnostic].join(" | ");
    dump("MARIONETTE TEST RESULT:" + msg + "\n");
  },

  repr: function Marionette__repr(o) {
      if (typeof(o) == "undefined") {
          return "undefined";
      } else if (o === null) {
          return "null";
      }
      try {
          if (typeof(o.__repr__) == 'function') {
              return o.__repr__();
          } else if (typeof(o.repr) == 'function' && o.repr != arguments.callee) {
              return o.repr();
          }
     } catch (e) {
     }
     try {
          if (typeof(o.NAME) == 'string' && (
                  o.toString == Function.prototype.toString ||
                  o.toString == Object.prototype.toString
              )) {
              return o.NAME;
          }
      } catch (e) {
      }
      try {
          var ostring = (o + "");
      } catch (e) {
          return "[" + typeof(o) + "]";
      }
      if (typeof(o) == "function") {
          o = ostring.replace(/^\s+/, "");
          var idx = o.indexOf("{");
          if (idx != -1) {
              o = o.substr(0, idx) + "{...}";
          }
      }
      return ostring;
  },
};

