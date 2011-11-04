
(function touchEventHandler() {
  var TouchEventHandler = {
    events: ['mousedown', 'mousemove', 'mouseup', 'mouseout', 'unload'],
    start: function teh_start() {
      this.events.forEach((function(evt) {
        shell.home.addEventListener(evt, this, true);
      }).bind(this));
    },
    stop: function teh_stop() {
      this.events.forEach((function(evt) {
        shell.home.removeEventListener(evt, this, true);
      }).bind(this));
    },
    handleEvent: function teh_handleEvent(evt) {
      var type = '';
      switch (evt.type) {
        case 'mousedown':
          this.target = evt.target;
          type = 'touchstart';
          break;
        case 'mousemove':
          type = 'touchmove';
          break;
        case 'mouseup':
          this.target = null;
          type = 'touchend';
          break;
        case 'mouseout':
          if (evt.relatedTarget)
            return;
          this.target = null;
          type = 'touchcancel';
          break;
        case 'unload':
          TouchEventHandler.stop();
          return;
      }

      if (this.target)
        this.sendTouchEvent(evt, this.target, type);
    },
    sendTouchEvent: function teh_sendTouchEvent(evt, target, name) {
      var touchEvent = document.createEvent("touchevent");
      var point = document.createTouch(window, target, 0,
                                     evt.pageX, evt.pageY,
                                     evt.screenX, evt.screenY,
                                     evt.clientX, evt.clientY,
                                     1, 1, 0, 0);
      var touches = document.createTouchList(point);
      var targetTouches = touches;
      var changedTouches = touches;
      touchEvent.initTouchEvent(name, true, true, window, 0,
                                false, false, false, false,
                                touches, targetTouches, changedTouches);
      return target.dispatchEvent(touchEvent);
    }
  };

  window.addEventListener('load', function touchStart(evt) {
    window.removeEventListener('load', touchStart, true);
    shell.home.addEventListener('load', function contentStart(evt) {
      shell.home.removeEventListener('load', contentStart);
      TouchEventHandler.start();
    }, true);
  }, true);
})();

