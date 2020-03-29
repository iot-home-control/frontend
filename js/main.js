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
};

let checkbox_initializer = (thing, e) => {
    let checkbox = e.querySelector("input[type='checkbox']");
    let span = e.querySelector("span[name='pending']");
    span.style.display = "none";
    let cb = () => {
        socket.send(JSON.stringify({
            type: "command",
            id: thing.id,
            value: checkbox.checked,
        }));
        const prev_value = !checkbox.checked;
        add_pending_change(thing, setTimeout(() => {
            checkbox.checked = prev_value;
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

    }
};

let set_status = (msg) => {
    const e = document.getElementById("status");
    e.innerText = msg;
};

let reconnect_attempt = 0;

let ws_connect = () => {
    socket = new WebSocket(config.ws_url);

    socket.addEventListener("open", function(event) {
        console.log("Connected");
        set_status("Connected");
        reconnect_attempt = 0;
    });
    
    socket.addEventListener("close", function(event) {
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

ws_connect();
