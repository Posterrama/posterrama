/**
 * Mock MQTT Client for Testing
 *
 * Provides a realistic MQTT client mock that simulates broker behavior
 * without requiring an actual MQTT broker connection.
 *
 * Features:
 * - Publish/subscribe simulation
 * - Message history tracking
 * - Assertion helpers
 * - Event emission (connect, message, error, etc.)
 */

const EventEmitter = require('events');

class MockMqttClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.published = [];
        this.subscriptions = new Set();
        this.connected = false;
        this.reconnecting = false;
        this.ended = false;

        // Auto-emit connect event after construction (simulates async connection)
        if (!options.delayConnect) {
            setImmediate(() => {
                this.connected = true;
                this.emit('connect');
            });
        }
    }

    /**
     * Publish a message to a topic
     * @param {string} topic - MQTT topic
     * @param {string|Buffer} payload - Message payload
     * @param {Object} options - Publish options (qos, retain, etc.)
     * @param {Function} callback - Completion callback
     */
    publish(topic, payload, options, callback) {
        // Handle overloaded signature (options optional)
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        if (this.ended) {
            const error = new Error('Client is ended');
            if (callback) callback(error);
            return this;
        }

        const message = {
            topic,
            payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload),
            options: options || {},
            timestamp: Date.now(),
        };

        this.published.push(message);

        // Simulate async publish
        if (callback) {
            setImmediate(() => callback(null));
        }

        return this;
    }

    /**
     * Subscribe to one or more topics
     * @param {string|string[]} topic - Topic(s) to subscribe to
     * @param {Object} options - Subscribe options
     * @param {Function} callback - Completion callback
     */
    subscribe(topic, options, callback) {
        // Handle overloaded signature
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        const topics = Array.isArray(topic) ? topic : [topic];
        topics.forEach(t => this.subscriptions.add(t));

        // Simulate async subscribe
        if (callback) {
            setImmediate(() =>
                callback(
                    null,
                    topics.map(t => ({ topic: t, qos: options?.qos || 0 }))
                )
            );
        }

        return this;
    }

    /**
     * Unsubscribe from one or more topics
     * @param {string|string[]} topic - Topic(s) to unsubscribe from
     * @param {Function} callback - Completion callback
     */
    unsubscribe(topic, callback) {
        const topics = Array.isArray(topic) ? topic : [topic];
        topics.forEach(t => this.subscriptions.delete(t));

        if (callback) {
            setImmediate(() => callback(null));
        }

        return this;
    }

    /**
     * End the client connection
     * @param {boolean} force - Force close without waiting
     * @param {Object} options - End options
     * @param {Function} callback - Completion callback
     */
    end(force, options, callback) {
        // Handle overloaded signature
        if (typeof force === 'function') {
            callback = force;
            force = false;
            options = {};
        } else if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        this.ended = true;
        this.connected = false;

        if (callback) {
            setImmediate(() => callback());
        }

        return this;
    }

    /**
     * Reconnect to the broker
     */
    reconnect() {
        this.reconnecting = true;
        this.connected = false;

        setImmediate(() => {
            this.reconnecting = false;
            this.connected = true;
            this.emit('connect');
        });

        return this;
    }

    // ==================== Test Helpers ====================

    /**
     * Simulate receiving a message from the broker
     * @param {string} topic - Topic the message was published to
     * @param {Object|string|Buffer} payload - Message payload
     */
    simulateMessage(topic, payload) {
        const buffer = Buffer.isBuffer(payload)
            ? payload
            : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));

        // Only emit if subscribed to this topic (supports wildcards)
        const isSubscribed = Array.from(this.subscriptions).some(sub =>
            this._topicMatches(sub, topic)
        );

        if (isSubscribed) {
            this.emit('message', topic, buffer);
        }
    }

    /**
     * Simulate a connection error
     * @param {Error} error - Error to emit
     */
    simulateError(error) {
        this.emit('error', error);
    }

    /**
     * Simulate broker disconnection
     */
    simulateDisconnect() {
        this.connected = false;
        this.emit('close');
    }

    /**
     * Get all published messages matching a topic pattern
     * @param {string|RegExp} topicPattern - Topic pattern (string or regex)
     * @returns {Array} Matching messages
     */
    getPublishedMessages(topicPattern) {
        const pattern = typeof topicPattern === 'string' ? new RegExp(topicPattern) : topicPattern;

        return this.published.filter(msg => pattern.test(msg.topic));
    }

    /**
     * Get the last published message for a topic
     * @param {string|RegExp} topicPattern - Topic pattern
     * @returns {Object|null} Last matching message
     */
    getLastPublishedMessage(topicPattern) {
        const messages = this.getPublishedMessages(topicPattern);
        return messages.length > 0 ? messages[messages.length - 1] : null;
    }

    /**
     * Get parsed payload from last published message
     * @param {string|RegExp} topicPattern - Topic pattern
     * @returns {Object|null} Parsed JSON payload
     */
    getLastPublishedPayload(topicPattern) {
        const message = this.getLastPublishedMessage(topicPattern);
        if (!message) return null;

        try {
            return JSON.parse(message.payload.toString());
        } catch {
            return message.payload.toString();
        }
    }

    /**
     * Clear published message history
     */
    clearPublished() {
        this.published = [];
    }

    /**
     * Check if client is subscribed to a topic
     * @param {string} topic - Topic to check
     * @returns {boolean}
     */
    isSubscribedTo(topic) {
        return this.subscriptions.has(topic);
    }

    /**
     * Get all current subscriptions
     * @returns {string[]}
     */
    getSubscriptions() {
        return Array.from(this.subscriptions);
    }

    /**
     * Reset client to initial state
     */
    reset() {
        this.published = [];
        this.subscriptions.clear();
        this.connected = false;
        this.reconnecting = false;
        this.ended = false;
        this.removeAllListeners();
    }

    // ==================== Private Helpers ====================

    /**
     * Check if a topic matches a subscription pattern (supports MQTT wildcards)
     * @private
     */
    _topicMatches(pattern, topic) {
        // Convert MQTT wildcards to regex
        // + matches a single level
        // # matches multiple levels
        const regexPattern = pattern
            .replace(/\+/g, '[^/]+')
            .replace(/#/g, '.*')
            .replace(/\//g, '\\/');

        return new RegExp(`^${regexPattern}$`).test(topic);
    }
}

/**
 * Factory function to create a mock MQTT client
 * Mimics the mqtt.connect() API
 */
function createMockMqttClient(brokerUrl, options = {}) {
    return new MockMqttClient({ brokerUrl, ...options });
}

module.exports = {
    MockMqttClient,
    createMockMqttClient,
};
