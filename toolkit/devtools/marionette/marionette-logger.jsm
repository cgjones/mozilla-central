var EXPORTED_SYMBOLS = ["MarionetteLogger"];

Components.utils.import("resource://gre/modules/FileUtils.jsm");

var xulAppInfo = Components.classes["@mozilla.org/xre/app-info;1"]
                 .getService(Components.interfaces.nsIXULAppInfo);
var isB2G = xulAppInfo.name.indexOf('B2G') > -1;

var MarionetteLogger = {
    _logstream: null,

    init: function ML__init() {
        if (!this._logstream) {
            if (isB2G) {
                var logf = Components.classes["@mozilla.org/file/local;1"]
                           .createInstance(Components.interfaces.nsILocalFile);
                logf.initWithPath('/data/marionette.log');
            }
            else {
                var logf = FileUtils.getFile('CurProcD', ['marionette.log']);
            }
            this._logstream = FileUtils.openSafeFileOutputStream(logf,
                FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_APPEND);
            this.write('logfile created ' + new Date());
        }
    },

    write: function ML__write(msg) {
        msg = msg + '\n';
        if (this._logstream)
            this._logstream.write(msg, msg.length);
    },
};

MarionetteLogger.init();




