/*!
 *  opentok-angular (https://github.com/aullman/OpenTok-Angular)
 *
 *  Angular module for OpenTok
 *
 *  @Author: Adam Ullman (http://github.com/aullman)
 *  @Copyright (c) 2014 Adam Ullman
 *  @License: Released under the MIT license (http://opensource.org/licenses/MIT)
 **/

if (!window.OT) throw new Error('You must include the OT library before the OT_Angular library');

var ng;
if (typeof angular === 'undefined' && typeof require !== 'undefined') {
  ng = require('angular');
} else {
  ng = angular;
}
var initLayoutContainer;
if (!window.hasOwnProperty('initLayoutContainer') && typeof require !== 'undefined') {
  initLayoutContainer = require('opentok-layout-js').initLayoutContainer;
} else {
  initLayoutContainer = window.initLayoutContainer;
}

ng.module('opentok', [])
  .factory('OT', function () {
    return OT;
  })
  .factory('OTSession', ['OT', '$rootScope',
    function (OT, $rootScope) {
      var OTSession = {
        streams: [],
        connections: [],
        publishers: [],

        init: function (apiKey, sessionId, token, options, cb) {
          // We need captionsArray to be available to all subscribers
          $rootScope.captionsArray = [];
          this.session = OT.initSession(apiKey, sessionId, options);

          OTSession.session.on({
            sessionConnected: function () {
              OTSession.publishers.forEach(function (publisher) {
                OTSession.session.publish(publisher, function (err) {
                  if (err) {
                    $rootScope.$broadcast('otPublisherError', err, publisher);
                  }
                });
              });
            },
            streamCreated: function (event) {
              $rootScope.$apply(function () {
                OTSession.streams.push(event.stream);
              });
            },
            streamDestroyed: function (event) {
              $rootScope.$apply(function () {
                OTSession.streams.splice(OTSession.streams.indexOf(event.stream), 1);
              });
            },
            sessionDisconnected: function () {
              $rootScope.$apply(function () {
                OTSession.streams.splice(0, OTSession.streams.length);
                OTSession.connections.splice(0, OTSession.connections.length);
              });
            },
            connectionCreated: function (event) {
              $rootScope.$apply(function () {
                OTSession.connections.push(event.connection);
              });
            },
            connectionDestroyed: function (event) {
              $rootScope.$apply(function () {
                OTSession.connections.splice(OTSession.connections.indexOf(event.connection), 1);
              });
            }
          });

          this.session.connect(token, function (err) {
            if (cb) cb(err, OTSession.session);
          });
          this.trigger('init');
        },
        addPublisher: function (publisher) {
          this.publishers.push(publisher);
          this.trigger('otPublisherAdded');
        }
      };
      OT.$.eventing(OTSession);
      return OTSession;
    }
  ])
  .directive('otLayout', ['$window', '$parse', 'OT', 'OTSession',
    function ($window, $parse, OT, OTSession) {
      return {
        restrict: 'E',
        scope: {
          props: '&'
        },
        link: function (scope, element, attrs) {
          var layout = function () {
            var props = scope.props() || {};
            var container = initLayoutContainer(element[0], props);
            container.layout();
            scope.$emit('otLayoutComplete');
          };
          scope.$watch(function () {
            return element.children().length;
          }, layout);
          $window.addEventListener('resize', layout);
          scope.$on('otLayout', layout);
          var listenForStreamChange = function listenForStreamChange() {
            OTSession.session.on('streamPropertyChanged', function (event) {
              if (event.changedProperty === 'videoDimensions') {
                layout();
              }
            });
          };
          if (OTSession.session) listenForStreamChange();
          else OTSession.on('init', listenForStreamChange);
        }
      };
    }
  ])
  .directive('otPublisher', ['OTSession', '$rootScope',
    function (OTSession, $rootScope) {
      return {
        restrict: 'E',
        scope: {
          props: '&'
        },
        link: function (scope, element, attrs) {
          var props = scope.props() || {};
          props.width = props.width ? props.width : ng.element(element).width();
          props.height = props.height ? props.height : ng.element(element).height();
          var oldChildren = ng.element(element).children();
          var publisherVideo;
          var canvas;
          var interval;

          if (props.videoSource === 'screenCanvas') {
            // Default values: HD at 15fps
            const width = props.screenwidth || 1280;
            const height = props.screenheight || 720;
            const framerate = props.framerate || 30;
            props.videoContentHint = 'detail';
            publisherVideo = document.createElement('video');
            navigator.mediaDevices.getDisplayMedia({ video: { width, height }, audio: false }).then((stream) => {
              stream.getTracks().forEach((track) => {
                track.addEventListener('ended', () => {
                  if (scope.publisher) {
                    scope.publisher.destroy();
                  }
                  publisherVideo = null;
                  canvas = null;
                  if (interval) {
                    clearInterval(interval)
                  }
                });
              });
              publisherVideo.srcObject = stream;
            }).catch(error => scope.$emit('otPublisherError', error, { id: 'screenPublisher' }));
            publisherVideo.play();
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            interval = setInterval(() => {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(publisherVideo, 0, 0);
            }, 1000 / framerate);
            props.videoSource = canvas.captureStream(framerate).getVideoTracks()[0];
          }

          scope.publisher = OT.initPublisher(attrs.apikey || OTSession.session.apiKey,
            element[0], props, function (err) {
              if (err) {
                scope.$emit('otPublisherError', err, scope.publisher);
              }
            });
          // Make transcluding work manually by putting the children back in there
          ng.element(element).append(oldChildren);
          scope.publisher.on({
            accessDenied: function () {
              scope.$emit('otAccessDenied');
            },
            accessDialogOpened: function () {
              scope.$emit('otAccessDialogOpened');
            },
            accessDialogClosed: function () {
              scope.$emit('otAccessDialogClosed');
            },
            accessAllowed: function () {
              ng.element(element).addClass('allowed');
              scope.$emit('otAccessAllowed');
            },
            loaded: function () {
              $rootScope.$broadcast('otLayout');
            },
            streamCreated: function (event) {
              scope.$emit('otStreamCreated', event);
            },
            streamDestroyed: function (event) {
              scope.$emit('otStreamDestroyed', event);
            },
            videoElementCreated: function (event) {
              event.element.addEventListener('resize', function () {
                $rootScope.$broadcast('otLayout');
              });
            }
          });
          scope.$on('$destroy', function () {
            if (OTSession.session) OTSession.session.unpublish(scope.publisher);
            else scope.publisher.destroy();
            OTSession.publishers = OTSession.publishers.filter(function (publisher) {
              return publisher !== scope.publisher;
            });
            scope.publisher = null;
            if (interval) {
              clearInterval(interval);
              publisherVideo = null;
              canvas = null;
            }
          });
          if (OTSession.session && (OTSession.session.connected ||
            (OTSession.session.isConnected && OTSession.session.isConnected()))) {
            OTSession.session.publish(scope.publisher, function (err) {
              if (err) {
                scope.$emit('otPublisherError', err, scope.publisher);
              }
            });
          }
          OTSession.addPublisher(scope.publisher);
        }
      };
    }
  ])
  .directive('otSubscriber', ['OTSession', '$rootScope',
    function (OTSession, $rootScope) {
      return {
        restrict: 'E',
        scope: {
          stream: '=',
          props: '&'
        },
        link: function (scope, element) {
          var stream = scope.stream,
            props = scope.props() || {};
          props.width = props.width ? props.width : ng.element(element).width();
          props.height = props.height ? props.height : ng.element(element).height();
          var oldChildren = ng.element(element).children();
          var subscriber = OTSession.session.subscribe(stream, element[0], props, function (err) {
            if (err) {
              scope.$emit('otSubscriberError', err, subscriber);
            }
          });

          const captionEventHandler = captionSubscriberTracker(OTSession, $rootScope)
          subscriber.on({
            loaded: function () {
              $rootScope.$broadcast('otLayout');
            },
            videoElementCreated: function (event) {
              event.element.addEventListener('resize', function () {
                $rootScope.$broadcast('otLayout');
              });
              // TODO ADD A BUTTON
              subscriber.subscribeToCaptions(true);
            },
            captionsReceived: function (event) {
              captionEventHandler(event, subscriber)
            }
          });
          // Make transcluding work manually by putting the children back in there
          ng.element(element).append(oldChildren);
          scope.$on('$destroy', function () {
            OTSession.session.unsubscribe(subscriber);
          });
        }
      };
    }
  ]);

  const captionSubscriberTracker = (OTSession, $rootScope) => {
    const MAX_SUBS_ON_SCREEN = 4;
    const CAPTIONS_TIMEOUT_MSEC = 5 * 1000;

    const captionBox = document.getElementById('caption-render-box');

    let namesByConnectionId = {};

    OTSession.session.on('signal:name', (event) => {
      namesByConnectionId[event.from.connectionId] = event.data;
    });
    // The following two functions are copied from opentok-textchat to ensure the speaker name
    // and textchat name line up
    const getNameFromConnection = (connection) => {
      let id = connection.creationTime.toString();
      id = id.substring(id.length - 6, id.length - 1);
      return `Guest${id}`;
    };
    const getName = (from) => {
      if (!namesByConnectionId[from.connectionId]) {
        namesByConnectionId[from.connectionId] = getNameFromConnection(from);
      }
      return namesByConnectionId[from.connectionId];
    };

    const captionsArray = $rootScope.captionsArray;

    const generateCaptionsString = () => {
      return captionsArray.map((captionElm) => {
        return `${captionElm.name}: ${captionElm.captionText}`
      }).join('\n');
    }
    const renderCaptionsArray = () => {
      const captionString = captionsArray.length > 0 ? generateCaptionsString() : '';
      captionBox.innerText = captionString;
    }

    const alreadyHasStream = (streamId) => {
      return captionsArray.some((elm) => elm.streamId === streamId);
    }

    const clearElementWithStreamId = (streamId) => {
      const indexOfElement = captionsArray.findIndex((element) => {
        return element.streamId === streamId
      })
      if (indexOfElement > -1) {
        clearTimeout(captionsArray[indexOfElement].timeout)
        captionsArray.splice(indexOfElement,1)
      }
    }

    const timeoutHandler = (streamId) => {
      clearElementWithStreamId(streamId)
      renderCaptionsArray();
    }

    const handleCaptionsEvent = (captionEvent,subscriber) => {
      const name = getName(subscriber.stream.connection);
      const captionElement = {
        streamId: captionEvent.streamId,
        captionText: captionEvent.caption,
        timeout: setTimeout(() => {
          timeoutHandler(captionEvent.streamId)
        },CAPTIONS_TIMEOUT_MSEC),
        name,
      }

      if (alreadyHasStream(captionEvent.streamId)){
        clearElementWithStreamId(captionEvent.streamId)
        captionsArray.unshift(captionElement)
        renderCaptionsArray();
        return;
      }

      captionsArray.unshift(captionElement)
      if (captionsArray.length > MAX_SUBS_ON_SCREEN) {
        clearElementWithStreamId(captionsArray[MAX_SUBS_ON_SCREEN].streamId)
      }
      renderCaptionsArray();
    }

    return handleCaptionsEvent;
  }
