
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
      var eventTarget = this.target;

      var type = '';
      switch (evt.type) {
        case 'mousedown':
          this.target = evt.target;
          this.timestamp = evt.timeStamp;
          type = 'touchstart';
          break;
        case 'mousemove':
          // On device a mousemove event if fired right after the mousedown
          // because of the size of the finger, so let's ignore what happens
          // below 5ms
          if (evt.timeStamp - this.timestamp < 5)
            return;
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

      var target = eventTarget || this.target;
      if (target) {
        this.sendTouchEvent(evt, target, type);
        evt.preventDefault();
        evt.stopPropagation();
      }
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

