const Dict = require('./dict').Dict;

let stream_dict = new Dict(); // stream_id -> array of objects

exports.stream_has_topics = function (stream_id) {
    if (!stream_dict.has(stream_id)) {
        return false;
    }

    const history = stream_dict.get(stream_id);

    return history.has_topics();
};

exports.topic_history = function (stream_id) {
    const topics = new Dict({fold_case: true});

    const self = {};

    self.has_topics = function () {
        return !topics.is_empty();
    };

    self.add_or_update = function (opts) {
        const name = opts.name;
        let message_id = opts.message_id || 0;

        message_id = parseInt(message_id, 10);

        const existing = topics.get(name);

        if (!existing) {
            topics.set(opts.name, {
                message_id: message_id,
                pretty_name: name,
                historical: false,
                count: 1,
            });
            return;
        }

        if (!existing.historical) {
            existing.count += 1;
        }

        if (message_id > existing.message_id) {
            existing.message_id = message_id;
            existing.pretty_name = name;
        }
    };

    self.maybe_remove = function (topic_name) {
        const existing = topics.get(topic_name);

        if (!existing) {
            return;
        }

        if (existing.historical) {
            // We can't trust that a topic rename applied to
            // the entire history of historical topic, so we
            // will always leave it in the sidebar.
            return;
        }

        if (existing.count <= 1) {
            topics.del(topic_name);
            return;
        }

        existing.count -= 1;
    };

    self.add_history = function (server_history) {
        // This method populates historical topics from the
        // server.  We have less data about these than the
        // client can maintain for newer topics.

        _.each(server_history, function (obj) {
            const name = obj.name;
            const message_id = obj.max_id;

            const existing = topics.get(name);

            if (existing) {
                if (!existing.historical) {
                    // Trust out local data more, since it
                    // maintains counts.
                    return;
                }
            }

            // If we get here, we are either finding out about
            // the topic for the first time, or we are getting
            // more current data for it.

            topics.set(name, {
                message_id: message_id,
                pretty_name: name,
                historical: true,
            });
        });
    };

    self.get_recent_names = function () {
        const my_recents = topics.values();

        const missing_topics = unread.get_missing_topics({
            stream_id: stream_id,
            topic_dict: topics,
        });

        const recents = my_recents.concat(missing_topics);

        recents.sort(function (a, b) {
            return b.message_id - a.message_id;
        });

        const names = _.map(recents, function (obj) {
            return obj.pretty_name;
        });

        return names;
    };

    return self;
};

exports.remove_message = function (opts) {
    const stream_id = opts.stream_id;
    const name = opts.topic_name;
    const history = stream_dict.get(stream_id);

    // This is the special case of "removing" a message from
    // a topic, which happens when we edit topics.

    if (!history) {
        return;
    }

    // This is the normal case of an incoming message.
    history.maybe_remove(name);
};

exports.find_or_create = function (stream_id) {
    let history = stream_dict.get(stream_id);

    if (!history) {
        history = exports.topic_history(stream_id);
        stream_dict.set(stream_id, history);
    }

    return history;
};

exports.add_message = function (opts) {
    const stream_id = opts.stream_id;
    const message_id = opts.message_id;
    const name = opts.topic_name;

    const history = exports.find_or_create(stream_id);

    history.add_or_update({
        name: name,
        message_id: message_id,
    });
};

exports.add_history = function (stream_id, server_history) {
    const history = exports.find_or_create(stream_id);
    history.add_history(server_history);
};

exports.get_server_history = function (stream_id, on_success) {
    const url = '/json/users/me/' + stream_id + '/topics';

    channel.get({
        url: url,
        data: {},
        success: function (data) {
            const server_history = data.topics;
            exports.add_history(stream_id, server_history);
            on_success();
        },
    });
};

exports.get_recent_names = function (stream_id) {
    const history = exports.find_or_create(stream_id);

    return history.get_recent_names();
};

exports.reset = function () {
    // This is only used by tests.
    stream_dict = new Dict();
};

window.topic_data = exports;
