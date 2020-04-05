"use strict";

let socket = null;
let things = {};

let update_float_value = (e, f) => {
    let span = e.querySelector("span[name='value']");
    span.innerText = f.toString();
};

let update_checkbox = (e, b) => {
    let checkbox = e.querySelector("input[type='checkbox']");
    checkbox.checked = b;
    let detail = e.querySelector(".thing-detail");
    detail.classList.remove(b ? "off": "on");
    detail.classList.add(b ? "on": "off");
};

let clear_pending_indicator = (e) => {
    if(e.nodeName == "SPAN") {
        e.style.display = "none";
        return;
    }

    let span = e.querySelector("span[name='pending']");
    span.style.display = "none";
};

const updaters = {
    temperature: (e, s, b, f) => { update_float_value(e, f); },
    humidity: (e, s, b, f) => { update_float_value(e, f); },
    shelly: (e, s, b, f) => { clear_pending_indicator(e); update_checkbox(e, b); },
    switch: (e, s, b, f) => { clear_pending_indicator(e); update_checkbox(e, b); },
}

let pending_changes = {};

let add_pending_change = (thing, id) => {
    if(!(thing.id in pending_changes))
        pending_changes[thing.id] = [];
    pending_changes[thing.id].push(id);
};

let cancel_pending_changes = (thing) => {
    if(!(thing.id in pending_changes))
        return;
    pending_changes[thing.id].forEach((id) => {
        clearTimeout(id);
    });
    pending_changes[thing.id] = [];
};

let checkbox_initializer = (thing, e) => {
    let div = e.querySelector("div.thing-detail");
    let checkbox = e.querySelector("input[type='checkbox']");
    div.addEventListener('click', () => {
        checkbox.click();
    });
    let span = e.querySelector("span[name='pending']");
    span.style.display = "none";
    let cb = () => {
        socket.send(JSON.stringify({
            type: "command",
            id: thing.id,
            value: checkbox.checked,
        }));
        div.classList.remove(checkbox.checked ? "off": "on");
        div.classList.add(checkbox.checked ? "on": "off");
        const prev_value = !checkbox.checked;
        add_pending_change(thing, setTimeout(() => {
            checkbox.checked = prev_value;
            div.classList.remove(checkbox.checked ? "off": "on");
            div.classList.add(checkbox.checked ? "on": "off");
            clear_pending_indicator(span);
        }, 1000));
        span.style.display = null;
    };
    checkbox.addEventListener("change", cb);
};

const initalizers = {
    shelly: checkbox_initializer,
    switch: checkbox_initializer,
};

let create_thing_element = (thing) => {
    const template = document.getElementById("template-" + thing.type);
    if(!template) {
        console.warn("No template for type", thing.type);
        return null;
    }

    let e = template.content.cloneNode(true);
    const e_id = "thing-" + thing.id;
    e.querySelector("div").id = e_id;

    let name_span = e.querySelector("span[name='name']");
    if(name_span)
        name_span.innerText = thing.name;

    if(thing.type in initalizers) {
        initalizers[thing.type](thing, e);
    }

    const things = document.getElementById("content");
    things.appendChild(e);

    return document.getElementById(e_id);
};

let update_thing_state = (thing, state) => {
    // Things only have an element assigned to them if we support their type
    if(!thing.element) {
        return;
    }
    if(!(thing.type in updaters)) {
        console.error("Can't update thing of type", thing.type);
        return;
    }
    cancel_pending_changes(thing);
    updaters[thing.type](thing.element, state.status_str, state.status_bool, state.status_float)
};

let current_view = "";
let views = {};

let show_view = (name) => {
    if(!(name in views)) {
        console.error("Can't display unknown view", name);
        return;
    }
    if(current_view === name) {
        return;
    }
    window.location.hash = name;
    const view_things = views[name];
    for(let thing of document.querySelectorAll(".thing")) {
        const id = parseInt(thing.id.split("-")[1]);
        if(view_things.includes(id)) {
            thing.style.display = "";
        } else {
            thing.style.display = "none";
        }
    }
    const current = document.querySelector("li.active");
    if(current)
        current.classList.remove("active")
    document.querySelector('a[href="#'+name+'"]').parentElement.classList.add("active")
    current_view = name;
};

let describe_time_diff = (seconds) => {
    if(seconds < 15)
        return "Just now";
    else if(seconds < 60)
        return seconds.toFixed() + " seconds ago";
    else if(seconds < 60*60)
        return (seconds/60).toFixed() + " minutes ago";
    else if(seconds < 60*60*24)
        return (seconds/60/60).toFixed() + " hours ago";
    else if(seconds < 60*60*24*7)
        return (seconds/60/60/24).toFixed() + " days ago";
    else if(seconds < 60*60*24*30)
        return (seconds/60/60/24/7).toFixed() + "weeks ago";
    else if(seconds < 60*60*24*356)
        return (seconds/60*60*24*30).toFixed() + " months ago";
    else
        return (seconds/60*60*24*356).toFixed() + " years ago";
}

let handle_message = (data) => {
    if(data.type === "things") {
        data.things.forEach(thing => {
            console.log("New thing", thing.name, "of type", thing.type);
            if(thing.id in things && things[thing.id].element)
                return;
            let element = create_thing_element(thing);
            thing.element = element;
            things[thing.id] = thing;
        });
    } else if(data.type === "states") {
        data.states.forEach((state) => {
            if(!state.thing_id in things) {
                console.warn("Got state for unknown thing", state.thing_id);
                return;
            }
            let thing = things[state.thing_id];
            update_thing_state(thing, state);
        });
    } else if(data.type === "views") {
        document.querySelectorAll(".thing-view").forEach((e) => { e.remove() });
        current_view = ""
        views = {}

        for(let [name, things] of Object.entries(data.views)) {
            let li = document.createElement("li");
            li.classList.add("menu-item");
            li.classList.add("thing-view");
            let a = document.createElement("a");
            a.href = "#" + name;
            a.innerText = name;
            li.appendChild(a);
            li.addEventListener("click", () => { show_view(name);})
            views[name] = things;

            document.querySelector("#bar").appendChild(li);
        }
        let saved_view = decodeURI(window.location.hash.substr(1));
        if(!saved_view)
            saved_view = Object.entries(views)[0][0];
        show_view(saved_view);
    } else if(data.type === "last_seen") {
        const now = Date.now();
        for(let [thing_id, timestamp] of Object.entries(data.last_seen)) {
            if(!(thing_id in things)) {
                continue;
            }
            const elem = things[thing_id].element;
            if(!elem) {
                continue;
            }
            if(timestamp === null) {
                elem.classList.add("timeout-unknown");
                continue;
            } else {
                elem.classList.remove("timeout-unknown");
            }
            const date = Date.parse(timestamp);
            const diff = now - date;
            if(diff > last_seen_warning_interval) {
                elem.classList.add("timed-out");

                let name_elem = elem.querySelector('.thing-name[rel="tooltip"]');
                if(!name_elem) {
                    name_elem = elem.querySelector(".thing-name");
                    name_elem.setAttribute("rel", "tooltip");
                    window.setup_tooltip(name_elem);
                }
                name_elem.title = "Last seen " + describe_time_diff(diff/1000);
            } else {
                elem.classList.remove("timed-out");
                let name_elem = elem.querySelector('.thing-name[rel="tooltip"]');
                if(name_elem) {
                    name_elem.setAttribute("rel", null);
                    name_elem.title = null;
                }
            }
        }
        current_last_seen_timeout_id = setTimeout(get_last_seen, get_last_seen_interval);
    }
};

let set_status = (msg) => {
    const e = document.getElementById("status");
    e.innerText = msg;
};

let get_last_seen = () => {
    if(!ws_connected) {
        return;
    }

    socket.send(JSON.stringify({type: "last_seen"}));
};

const last_seen_warning_interval = 3 * 60 * 1000;
const get_last_seen_interval = 30 * 1000;
let ws_connected = false;
let reconnect_attempt = 0;
let current_last_seen_timeout_id = null;

let ws_connect = () => {
    socket = new WebSocket(config.ws_url);

    socket.addEventListener("open", function(event) {
        console.log("Connected");
        set_status("Connected");
        reconnect_attempt = 0;
        ws_connected = true;

        if(current_last_seen_timeout_id) {
            clearTimeout(current_last_seen_timeout_id);
            current_last_seen_timeout_id = null;
        }

        get_last_seen();
    });
    
    socket.addEventListener("close", function(event) {
        ws_connected = false;
        const time = 1000 + reconnect_attempt*1000;
        const status_str = "Disconnected. Trying to reconnect in "+ time/1000 + " seconds.";
        set_status(status_str);
        console.log(status_str);

        setTimeout(() => {
            ws_connect();
        }, time);
        
        if(reconnect_attempt < (60*5)-1)
            reconnect_attempt += 1;
    });
    
    socket.addEventListener("message", function(event) {
        const data = JSON.parse(event.data);
        handle_message(data);
    });
};

document.addEventListener("DOMContentLoaded", () => {
    ws_connect();
    document.querySelector(".toggle a").addEventListener('click', () => {
        document.querySelectorAll(".menu-item").forEach((item) => {
            if(!item.style.display || item.style.display === "none") {
                item.style.display = "block";
            } else {
                item.style.display = "none";
            }
        });
    });
});
