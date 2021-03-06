( function ( mw, $ ) {
	'use strict';

	var notification,
		// The #mw-notification-area div that all notifications are contained inside.
		$area,
		// Number of open notification boxes at any time
		openNotificationCount = 0,
		isPageReady = false,
		preReadyNotifQueue = [],
		rAF = window.requestAnimationFrame || setTimeout;

	/**
	 * A Notification object for 1 message.
	 *
	 * The underscore in the name is to avoid a bug <https://github.com/senchalabs/jsduck/issues/304>.
	 * It is not part of the actual class name.
	 *
	 * The constructor is not publicly accessible; use mw.notification#notify instead.
	 * This does not insert anything into the document (see #start).
	 *
	 * @class mw.Notification_
	 * @alternateClassName mw.Notification
	 * @constructor
	 * @private
	 * @param {mw.Message|jQuery|HTMLElement|string} message
	 * @param {Object} options
	 */
	function Notification( message, options ) {
		var $notification, $notificationContent;

		$notification = $( '<div class="mw-notification"></div>' )
			.data( 'mw.notification', this )
			.addClass( options.autoHide ? 'mw-notification-autohide' : 'mw-notification-noautohide' );

		if ( options.tag ) {
			// Sanitize options.tag before it is used by any code. (Including Notification class methods)
			options.tag = options.tag.replace( /[ _\-]+/g, '-' ).replace( /[^\-a-z0-9]+/ig, '' );
			if ( options.tag ) {
				$notification.addClass( 'mw-notification-tag-' + options.tag );
			} else {
				delete options.tag;
			}
		}

		if ( options.type ) {
			// Sanitize options.type
			options.type = options.type.replace( /[ _\-]+/g, '-' ).replace( /[^\-a-z0-9]+/ig, '' );
			$notification.addClass( 'mw-notification-type-' + options.type );
		}

		if ( options.title ) {
			$( '<div class="mw-notification-title"></div>' )
				.text( options.title )
				.appendTo( $notification );
		}

		$notificationContent = $( '<div class="mw-notification-content"></div>' );

		if ( typeof message === 'object' ) {
			// Handle mw.Message objects separately from DOM nodes and jQuery objects
			if ( message instanceof mw.Message ) {
				$notificationContent.html( message.parse() );
			} else {
				$notificationContent.append( message );
			}
		} else {
			$notificationContent.text( message );
		}

		$notificationContent.appendTo( $notification );

		// Private state parameters, meant for internal use only
		// isOpen: Set to true after .start() is called to avoid double calls.
		//         Set back to false after .close() to avoid duplicating the close animation.
		// isPaused: false after .resume(), true after .pause(). Avoids duplicating or breaking the hide timeouts.
		//           Set to true initially so .start() can call .resume().
		// message: The message passed to the notification. Unused now but may be used in the future
		//          to stop replacement of a tagged notification with another notification using the same message.
		// options: The options passed to the notification with a little sanitization. Used by various methods.
		// $notification: jQuery object containing the notification DOM node.
		this.isOpen = false;
		this.isPaused = true;
		this.message = message;
		this.options = options;
		this.$notification = $notification;
	}

	/**
	 * Start the notification. Called automatically by mw.notification#notify
	 * (possibly asynchronously on document-ready).
	 *
	 * This inserts the notification into the page, closes any matching tagged notifications,
	 * handles the fadeIn animations and replacement transitions, and starts autoHide timers.
	 *
	 * @private
	 */
	Notification.prototype.start = function () {
		var options, $notification, $tagMatches, autohideCount;

		$area.show();

		if ( this.isOpen ) {
			return;
		}

		this.isOpen = true;
		openNotificationCount++;

		options = this.options;
		$notification = this.$notification;

		if ( options.tag ) {
			// Find notifications with the same tag
			$tagMatches = $area.find( '.mw-notification-tag-' + options.tag );
		}

		// If we found existing notification with the same tag, replace them
		if ( options.tag && $tagMatches.length ) {

			// While there can be only one "open" notif with a given tag, there can be several
			// matches here because they remain in the DOM until the animation is finished.
			$tagMatches.each( function () {
				var notif = $( this ).data( 'mw.notification' );
				if ( notif && notif.isOpen ) {
					// Detach from render flow with position absolute so that the new tag can
					// occupy its space instead.
					notif.$notification
						.css( {
							position: 'absolute',
							width: notif.$notification.width()
						} )
						.css( notif.$notification.position() )
						.addClass( 'mw-notification-replaced' );
					notif.close();
				}
			} );

			$notification
				.insertBefore( $tagMatches.first() )
				.addClass( 'mw-notification-visible' );
		} else {
			$area.append( $notification );
			rAF( function () {
				// This frame renders the element in the area (invisible)
				rAF( function () {
					$notification.addClass( 'mw-notification-visible' );
				} );
			} );
		}

		// By default a notification is paused.
		// If this notification is within the first {autoHideLimit} notifications then
		// start the auto-hide timer as soon as it's created.
		autohideCount = $area.find( '.mw-notification-autohide' ).length;
		if ( autohideCount <= notification.autoHideLimit ) {
			this.resume();
		}
	};

	/**
	 * Pause any running auto-hide timer for this notification
	 */
	Notification.prototype.pause = function () {
		if ( this.isPaused ) {
			return;
		}
		this.isPaused = true;

		if ( this.timeout ) {
			clearTimeout( this.timeout );
			delete this.timeout;
		}
	};

	/**
	 * Start autoHide timer if not already started.
	 * Does nothing if autoHide is disabled.
	 * Either to resume from pause or to make the first start.
	 */
	Notification.prototype.resume = function () {
		var notif = this;
		if ( !notif.isPaused ) {
			return;
		}
		// Start any autoHide timeouts
		if ( notif.options.autoHide ) {
			notif.isPaused = false;
			notif.timeout = setTimeout( function () {
				// Already finished, so don't try to re-clear it
				delete notif.timeout;
				notif.close();
			}, notification.autoHideSeconds * 1000 );
		}
	};

	/**
	 * Close the notification.
	 */
	Notification.prototype.close = function () {
		var notif = this;

		if ( !this.isOpen ) {
			return;
		}

		this.isOpen = false;
		openNotificationCount--;

		// Clear any remaining timeout on close
		this.pause();

		// Remove the mw-notification-autohide class from the notification to avoid
		// having a half-closed notification counted as a notification to resume
		// when handling {autoHideLimit}.
		this.$notification.removeClass( 'mw-notification-autohide' );

		// Now that a notification is being closed. Start auto-hide timers for any
		// notification that has now become one of the first {autoHideLimit} notifications.
		notification.resume();

		rAF( function () {
			notif.$notification.removeClass( 'mw-notification-visible' );

			setTimeout( function () {
				if ( openNotificationCount === 0 ) {
					// Hide the area after the last notification closes. Otherwise, the padding on
					// the area can be obscure content, despite the area being empty/invisible (T54659). // FIXME
					$area.hide();
					notif.$notification.remove();
				} else {
					notif.$notification.slideUp( 'fast', function () {
						$( this ).remove();
					} );
				}
			}, 500 );
		} );
	};

	/**
	 * Helper function, take a list of notification divs and call
	 * a function on the Notification instance attached to them.
	 *
	 * @private
	 * @static
	 * @param {jQuery} $notifications A jQuery object containing notification divs
	 * @param {string} fn The name of the function to call on the Notification instance
	 */
	function callEachNotification( $notifications, fn ) {
		$notifications.each( function () {
			var notif = $( this ).data( 'mw.notification' );
			if ( notif ) {
				notif[ fn ]();
			}
		} );
	}

	/**
	 * Initialisation.
	 * Must only be called once, and not before the document is ready.
	 *
	 * @ignore
	 */
	function init() {
		var offset,
			isFloating = false;

		$area = $( '<div id="mw-notification-area" class="mw-notification-area mw-notification-area-layout"></div>' )
			// Pause auto-hide timers when the mouse is in the notification area.
			.on( {
				mouseenter: notification.pause,
				mouseleave: notification.resume
			} )
			// When clicking on a notification close it.
			.on( 'click', '.mw-notification', function () {
				var notif = $( this ).data( 'mw.notification' );
				if ( notif ) {
					notif.close();
				}
			} )
			// Stop click events from <a> tags from propogating to prevent clicking.
			// on links from hiding a notification.
			.on( 'click', 'a', function ( e ) {
				e.stopPropagation();
			} );

		// Prepend the notification area to the content area and save it's object.
		mw.util.$content.prepend( $area );
		offset = $area.offset();
		$area.hide();

		function updateAreaMode() {
			var shouldFloat = window.pageYOffset > offset.top;
			if ( isFloating === shouldFloat ) {
				return;
			}
			isFloating = shouldFloat;
			$area
				.toggleClass( 'mw-notification-area-floating', isFloating )
				.toggleClass( 'mw-notification-area-layout', !isFloating );
		}

		$( window ).on( 'scroll', updateAreaMode );

		// Initial mode
		updateAreaMode();
	}

	/**
	 * @class mw.notification
	 * @singleton
	 */
	notification = {
		/**
		 * Pause auto-hide timers for all notifications.
		 * Notifications will not auto-hide until resume is called.
		 *
		 * @see mw.Notification#pause
		 */
		pause: function () {
			callEachNotification(
				$area.children( '.mw-notification' ),
				'pause'
			);
		},

		/**
		 * Resume any paused auto-hide timers from the beginning.
		 * Only the first #autoHideLimit timers will be resumed.
		 */
		resume: function () {
			callEachNotification(
				// Only call resume on the first #autoHideLimit notifications.
				// Exclude noautohide notifications to avoid bugs where #autoHideLimit
				// `{ autoHide: false }` notifications are at the start preventing any
				// auto-hide notifications from being autohidden.
				$area.children( '.mw-notification-autohide' ).slice( 0, notification.autoHideLimit ),
				'resume'
			);
		},

		/**
		 * Display a notification message to the user.
		 *
		 * @param {HTMLElement|HTMLElement[]|jQuery|mw.Message|string} message
		 * @param {Object} options The options to use for the notification.
		 *  See #defaults for details.
		 * @return {mw.Notification} Notification object
		 */
		notify: function ( message, options ) {
			var notif;
			options = $.extend( {}, notification.defaults, options );

			notif = new Notification( message, options );

			if ( isPageReady ) {
				notif.start();
			} else {
				preReadyNotifQueue.push( notif );
			}

			return notif;
		},

		/**
		 * @property {Object}
		 * The defaults for #notify options parameter.
		 *
		 * - autoHide:
		 *   A boolean indicating whether the notifification should automatically
		 *   be hidden after shown. Or if it should persist.
		 *
		 * - tag:
		 *   An optional string. When a notification is tagged only one message
		 *   with that tag will be displayed. Trying to display a new notification
		 *   with the same tag as one already being displayed will cause the other
		 *   notification to be closed and this new notification to open up inside
		 *   the same place as the previous notification.
		 *
		 * - title:
		 *   An optional title for the notification. Will be displayed above the
		 *   content. Usually in bold.
		 *
		 * - type:
		 *   An optional string for the type of the message used for styling:
		 *   Examples: 'info', 'warn', 'error'.
		 */
		defaults: {
			autoHide: true,
			tag: false,
			title: undefined,
			type: false
		},

		/**
		 * @property {number}
		 * Number of seconds to wait before auto-hiding notifications.
		 */
		autoHideSeconds: 5,

		/**
		 * @property {number}
		 * Maximum number of notifications to count down auto-hide timers for.
		 * Only the first #autoHideLimit notifications being displayed will
		 * auto-hide. Any notifications further down in the list will only start
		 * counting down to auto-hide after the first few messages have closed.
		 *
		 * This basically represents the number of notifications the user should
		 * be able to process in #autoHideSeconds time.
		 */
		autoHideLimit: 3
	};

	$( function () {
		var notif;

		init();

		// Handle pre-ready queue.
		isPageReady = true;
		while ( preReadyNotifQueue.length ) {
			notif = preReadyNotifQueue.shift();
			notif.start();
		}
	} );

	mw.notification = notification;

}( mediaWiki, jQuery ) );
