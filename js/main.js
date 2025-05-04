// SPDX-License-Identifier: AGPL-3.0-or-later
/*
Copyright (C) 2021 The Home Control Authors

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

"use strict";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

let socket = null;
let things = {};

let edit_mode_active = false;
let current_overlay = null;

let countdowns = {}

let update_float_value = (e, f) => {
    let span = e.querySelector("span[name='value']");
    span.innerText = f.toString();
};

const update_float_value_with_units = (e, f, unit_func) => {
    const unit_element = e.querySelector("div.thing-value");
    if (unit_func) {
        const {unit, scaled} = unit_func(f);
        unit_element.lastChild.textContent = ` ${unit}`;
        f = scaled;
    }
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
    let detail = e.querySelector(".thing-detail");
    detail.classList.remove("pending");
};

const round_to_digits = (value, digits=0) => {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
};

const power_reading_unit_func = (value) => {
    if (Math.abs(value) < 1000) {
        return { unit: "W", scaled: value };
    } else {
        return { unit: "kW", scaled: round_to_digits(value / 1000, 2) }
    }
}

const energy_reading_unit_func = (value) => {
    if (Math.abs(value) < 1000) {
        return { unit: "Wh", scaled: value };
    } else {
        return { unit: "kWh", scaled: round_to_digits(value / 1000, 2) }
    }
}

const updaters = {
    temperature: (e, s, b, f) => { update_float_value(e, f); },
    humidity: (e, s, b, f) => { update_float_value(e, f); },
    shelly_temperature: (e, s, b, f) => { update_float_value(e, f); },
    shelly_humidity: (e, s, b, f) => { update_float_value(e, f); },
    shellytrv: (e, s, b, f) => { update_float_value(e, f); },
    soilmoisture: (e, s, b, f) => { update_float_value(e, f); },
    pressure: (e, s, b, f) => { update_float_value(e, f); },
    shelly: (e, s, b, f) => { clear_pending_indicator(e); update_checkbox(e, b); },
    shellyplus: (e, s, b, f) => { clear_pending_indicator(e); update_checkbox(e, b); },
    switch: (e, s, b, f) => { clear_pending_indicator(e); update_checkbox(e, b); },
    "frischluftworks-co2": (e, s, b, f) => { update_float_value(e, f); },
    shelly_power: (e, s, b, f) => { update_float_value_with_units(e, f, power_reading_unit_func); },
    shelly_energy: (e, s, b, f) => { update_float_value_with_units(e, f, energy_reading_unit_func); },
    esp32_smartmeter_power: (e, s, b, f) => { update_float_value_with_units(e, f, power_reading_unit_func); },
    esp32_smartmeter_energy: (e, s, b, f) => { update_float_value_with_units(e, f, energy_reading_unit_func); },
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

const show_thing_edit = (value) => {
    edit_mode_active = value;
    document.getElementById('settings').classList.toggle('active', value);
    for(const elem of document.querySelectorAll('.edit')) {
        elem.style.display = value ? 'block' : 'none';
    }
    if(value) {
        for(const elem of document.querySelectorAll('#content .invisible')) {
            elem.classList.remove('invisible');
            elem.classList.add('invisible-edit');
        }
    } else {
        for(const elem of document.querySelectorAll('#content .invisible-edit')) {
            elem.classList.add('invisible');
            elem.classList.remove('invisible-edit');
        }
    }

    const thing_add = document.querySelector('.thing-add')
    const things = document.getElementById("content");
    if(value && !thing_add) {
        const template = document.getElementById("template-add");
        let e = template.content.cloneNode(true);
        apply_feather(e);

        e.querySelector('div.thing-detail').addEventListener('click', () => {
            socket.send(JSON.stringify({
                type: "create_or_edit",
                id: null,
            }));
            show_thing_edit(false);
        });

        const things = document.getElementById("content");
        things.appendChild(e);
    } else if(!value && thing_add) {
        things.removeChild(thing_add);
    }
};

let checkbox_initializer = (thing, e) => {
    let div = e.querySelector("div.thing-detail");
    let checkbox = e.querySelector("input[type='checkbox']");
    div.addEventListener('click', () => {
        checkbox.click();
        div.classList.add("pending");
    });

    let cb = () => {

        //console.log(div);
        socket.send(JSON.stringify({
            type: "command",
            id: thing.id,
            value: checkbox.checked,
        }));

        const prev_value = !checkbox.checked;
        add_pending_change(thing, setTimeout(() => {
            checkbox.checked = prev_value;
            div.classList.remove(checkbox.checked ? "off": "on");
            div.classList.add(checkbox.checked ? "on": "off");
            div.classList.remove("pending");
        }, 1000));
        div.classList.remove("pending");
    };
    checkbox.addEventListener("change", cb);
};

let plusminus_initializer = (thing, e) => {
    let div = e.querySelector("div.thing-detail");
    let plus = e.querySelector("span[name='plus']");
    let minus = e.querySelector("span[name='minus']");
    let value_ele = e.querySelector("span[name='value']");
    let old_value;
    let new_value;
    let cb = () => {
        socket.send(JSON.stringify({
            type: "command",
            id: thing.id,
            value: new_value,
        }));
        add_pending_change(thing, setTimeout(() => {
            console.log("timeout exceeded");
            value_ele.innerText = new_value;
            div.classList.remove("pending");
        }, 1000));
        value_ele.innerText = old_value;
    };

    plus.addEventListener('click', () => {
        //plus.click()
        div.classList.add("pending");
        old_value = parseInt(value_ele.innerText)
        new_value = old_value + 1
        cb()
    });
    minus.addEventListener('click', () => {
        //minus.click();
        div.classList.add("pending");
        old_value = parseInt(value_ele.innerText)
        new_value = old_value - 1;
        cb()
    });
};

const initalizers = {
    shelly: checkbox_initializer,
    shellyplus: checkbox_initializer,
    switch: checkbox_initializer,
    shellytrv: plusminus_initializer,
};

let apply_feather = (root) => {
    for(let element of root.querySelectorAll("[data-feather]")) {
        let svgElem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgElem.classList = element.classList;

        let useElem = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        useElem.setAttribute("href", "img/feather-sprite.svg#" + element.dataset.feather);

        svgElem.appendChild(useElem);
        element.parentElement.replaceChild(svgElem, element);
    }
}

let create_thing_element = (thing) => {
    const template = document.getElementById("template-" + thing.type);
    if(!template) {
        console.warn("No template for type", thing.type);
        return null;
    }

    let e = template.content.cloneNode(true);
    const e_id = "thing-" + thing.id
    let thing_root = e.querySelector("div");
    thing_root.id = e_id;
    thing_root.classList.toggle('invisible', !thing.visible);

    const edit = e.querySelector('.edit');
    if(edit) {
        edit.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            socket.send(JSON.stringify({
                type: "create_or_edit",
                id: thing.id,
            }));
            show_thing_edit(false);
        });
    }

    let name_span = e.querySelector("span[name='name']");
    if(name_span)
        name_span.innerText = thing.name;

    if(thing.type in initalizers) {
        initalizers[thing.type](thing, e);
    }

    apply_feather(e);
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
        thing.classList.toggle('invisible', !view_things.includes(id) || !things[id].visible);
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
        return (seconds/60/60/24/7).toFixed() + " weeks ago";
    else if(seconds < 60*60*24*356)
        return (seconds/60/60/24/30).toFixed() + " months ago";
    else
        return (seconds/60/60/24/356).toFixed() + " years ago";
}

const show_thing_edit_dialog = (data) => {
    const template = document.getElementById("template-edit-thing");
    if(!template) {
        console.warn("No template for type", thing.type);
        return null;
    }

    const e = template.content.cloneNode(true);

    const thing_name = e.querySelector('*[name=thing-name]'); thing_name.value = data.name;
    const thing_id = e.querySelector('*[name=thing-id]'); thing_id.value = data.id;
    const type_select = e.querySelector('*[name=thing-type]');
    for(const entry of data.types) {
        const element = document.createElement('option');
        element.value = entry.value;
        element.text = entry.text;
        element.selected = entry.value === data.thing_type;
        type_select.add(element);
    }
    if(data.device_id) {
        type_select.disabled = true;
    }
    const thing_device_id = e.querySelector('*[name=thing-device-id]'); thing_device_id.value = data.device_id;
    const thing_vnode = e.querySelector('*[name=thing-vnode]'); thing_vnode.value = data.vnode;
    const thing_visible = e.querySelector('*[name=thing-visible]'); thing_visible.options[data.visible ? 0 : 1].selected = true;
    const views_select = e.querySelector('*[name=thing-views]');
    const thing_ordering = e.querySelector('*[name=thing-ordering]'); thing_ordering.value = data.ordering;
    for(const entry of data.views) {
        const element = document.createElement('option');
        element.value = entry.value;
        element.text = entry.text;
        element.selected = data.thing_views.find(element => element === entry.value);
        views_select.add(element);
    }

    const overlay = document.createElement('div');
    overlay.setAttribute('class', 'overlay');

    e.querySelector('button[name=button-accept]').addEventListener('click', (btn) => {
        btn.preventDefault();
        socket.send(JSON.stringify({
            type: "edit_save",
            editing: "thing",
            data: {
                id: thing_id.value,
                name: thing_name.value,
                thing_type: type_select.value,
                device_id: thing_device_id.value,
                vnode: thing_vnode.value,
                ordering: thing_ordering.value,
                visible: thing_visible.value === "true",
                views: Array.from(views_select.selectedOptions).map(o => ({value: o.value, text: o.text})),
            },
        }));
    });
    e.querySelector('button[name=button-reject]').addEventListener('click', (btn) => {
        btn.preventDefault();
        overlay.style.display = 'none';
        overlay.parentNode.removeChild(overlay);
    });

    overlay.appendChild(e);

    return overlay;
}

const make_login_dialog = (data) => {
    const template = document.getElementById("template-login");
    if(!template) {
        return null;
    }

    const e = template.content.cloneNode(true);

    const username_input = e.querySelector('*[name=username]');
    const password_input = e.querySelector('*[name=password]');

    const overlay = document.createElement('div');
    overlay.setAttribute('class', 'overlay');

    e.querySelector('button[name=button-accept]').addEventListener('click', (btn) => {
        btn.preventDefault();
        authenticate(username_input.value, password_input.value)
    });
    e.querySelector('button[name=button-reject]').addEventListener('click', (btn) => {
        btn.preventDefault();
        overlay.style.display = 'none';
        overlay.parentNode.removeChild(overlay);
    });

    overlay.appendChild(e);
    return overlay;
}

const show_login_dialog = () => {
    current_overlay = make_login_dialog();
    document.getElementsByTagName('body')[0].appendChild(current_overlay);
    current_overlay.querySelector('*[name=username]').focus()
}

let authenticate = (username, password) => {
    socket.send(JSON.stringify({
        type: "authenticate",
        username: username,
        password: password,
    }));
}

let close_dialog = () => {
    current_overlay.parentNode.removeChild(current_overlay);
    current_overlay = null;
    stop_all_countdowns()
}


let show_rules = () => {
    current_overlay = show_dynamic_dialog("Rules")
    document.getElementsByTagName('body')[0].appendChild(current_overlay);
    socket.send(JSON.stringify({
        type: "rules"}))
}


let update_rule_state = (rule_name, state) => {
    socket.send(JSON.stringify({
        type: "rules",
        data: {[rule_name]: {enabled: state}}
    }))
}

let update_rules_dialog = (data) => {
    const content = document.querySelector(".dialog")
    const close_button = content.querySelector("button")
    data.forEach((rule) => {
        const rule_checkbox = content.querySelector(`input[name="${rule.name}"]`)
        if(rule_checkbox) {
            rule_checkbox.checked = rule.state;
            const parent = rule_checkbox.parentElement
            parent.querySelector("svg")?.remove()
            const icon = document.createElement("i")
            icon.classList.add("icon")
            icon.setAttribute("data-feather", rule_checkbox.checked ? "check-square" : "square" );
            parent.appendChild(icon)
            apply_feather(parent)

        } else {
    //<div class="label"><label for="thing-name">Name</label></div>
    //<div class="control"><input type="text" name="thing-name"></input></div>
            const label_div = document.createElement("div")
            label_div.classList.add("label")
            const control_div = document.createElement("div")
            control_div.classList.add("control")

            const wrapper = document.createElement("span");
            const label = document.createElement("label")
            const checkbox = document.createElement("input")
            checkbox.type = "checkbox"
            checkbox.name = rule.name
            checkbox.checked = rule.state
            wrapper.addEventListener("click", () => {
                const new_state = !checkbox.checked
                const rule_name = checkbox.name
                console.log("New rule state ", rule_name, new_state)
                update_rule_state(rule_name, new_state);
            });
            const icon = document.createElement("i")
            icon.classList.add("icon")
            icon.setAttribute("data-feather", checkbox.checked ? "check-square" : "square" );
            label.innerText = rule.name
            label.htmlFor = checkbox.name
            label_div.appendChild(label)
            wrapper.append(checkbox);
            wrapper.append(icon);
            control_div.appendChild(wrapper)
            content.insertBefore(label_div, close_button)
            content.insertBefore(control_div, close_button)
            apply_feather(content)
        }
    });
};

let show_dynamic_dialog = (title, show_save_button = false) => {
    const template = document.getElementById("template-dynamic-dialog");
    if(!template) {
        console.warn("No dialog template found.");
        return null;
    }

    const dialog = template.content.cloneNode(true);
    const content = dialog.querySelector(".dialog")
    const heading = document.createElement("span")
    heading.innerHTML = "<b>" + title + "</b>"
    heading.classList.add("single")
    content.appendChild(heading)
    if(show_save_button) {
        const saveButton = document.createElement("button")
        saveButton.classList.add("label")
        saveButton.name = "save";
        saveButton.innerHTML = 'Save'
        content.appendChild(saveButton)
    }


    const closeButton = document.createElement("button")
    show_save_button ? closeButton.classList.add("control") : closeButton.classList.add("single");
    closeButton.addEventListener("click", close_dialog)
    closeButton.name = "close"
    closeButton.innerHTML = 'Close'
    content.appendChild(closeButton)

    const overlay = document.createElement('div');
    overlay.setAttribute('class', 'overlay');
    overlay.appendChild(dialog)
    apply_feather(overlay)

    return overlay;
}

let show_timers = () => {
    current_overlay = show_dynamic_dialog("Timers", true)
    document.getElementsByTagName('body')[0].appendChild(current_overlay);
    socket.send(JSON.stringify({
        type: "get_timers"
    }))
}

  let leading_zeros = (value, number_of_digits=2) => {
        return ("0".repeat(number_of_digits).concat(value)).slice(number_of_digits * -1)
    }

let add_countdown = (name, element, schedule) => {



    const count_down_date = new Date(schedule);

    if(countdowns[name]) {
        clearInterval(countdowns[name])
    }
    countdowns[name] = setInterval(() => {
        const now = new Date().getTime();
        // We want seconds
        const distance = Math.round((count_down_date - now) / 1000);

        const days = Math.trunc(distance / (24 * 60 * 60))
        const hours = leading_zeros(Math.trunc(distance % (24 * 60 * 60) / (60 * 60)))
        const minutes = leading_zeros(Math.trunc(distance % (60 * 60) / 60))
        const seconds = leading_zeros(Math.trunc(distance % 60))


        let date_str = ""
        if(days > 0) {
            date_str = days + "d"
        } else {
            if(hours > 0 ) {
                date_str = hours + "h"
            }
            if(minutes > 0  ||  hours > 0) {
                date_str = date_str + " " + minutes + "m"
            }
            if(seconds > 0 ||  hours > 0 || minutes > 0 ) {
                date_str = date_str + " " + seconds + "s"
            }
        }
        if(date_str === "") {
            date_str = "pending"
        }
        element.innerHTML = date_str
    }, 1000)
}

let stop_all_countdowns = () => {
    Object.entries(countdowns).forEach(countdown => {
        clearInterval(countdown[1])
        countdowns[countdown[0]] = undefined
    })
}

let update_timers_dialog = (data, rules) => {
    const content = document.querySelector(".dialog")
    const close_button = content.querySelector("button[name=close]")
    const save_button = content.querySelector("button[name=save]")
    if(save_button) {
        save_button.name = "button-new_timer"
        save_button.innerText = "Add Timer"
        //save_button.classList.add("single")
        save_button.addEventListener("click", (btn) => {
            btn.preventDefault()
            show_timer_edit_dialog({}, rules)
        })
    }
    /*<div class="single" style="display: grid;grid-template-columns: auto auto auto auto;grid-column-gap: 1em;">
   <div> Name </div> <div> Scheduled </div> <div> Enabled </div> <div> Edit </div></div>*/
    let outerGrid = document.querySelector("#timer-grid");
    if(!outerGrid) {
        outerGrid = document.createElement("div")
        outerGrid.id = "timer-grid";
        outerGrid.classList.add("single")
        outerGrid.classList.add("four-columns")
        content.insertBefore(outerGrid, save_button)
    }

    for (const timer of data) {
        const timer_checkbox = content.querySelector(`input[name="${timer.id}"]`)
        if(timer_checkbox) {
            timer_checkbox.checked = timer.enabled
            const parent = timer_checkbox.parentElement
            parent.querySelector("svg")?.remove()
            const icon = document.createElement("i")
            icon.classList.add("icon")
            icon.setAttribute("data-feather", timer_checkbox.checked ? "check-square" : "square");
            parent.appendChild(icon)
            apply_feather(parent)
            const schedule= outerGrid.querySelector(`#timer-${timer.id}`)
            add_countdown(timer.id, schedule, timer.schedule)
        } else {
            const name = document.createElement("div")
            name.innerHTML = timer.id
            outerGrid.appendChild(name)
            const schedule = document.createElement("div")
            schedule.id = `timer-${timer.id}`
            schedule.classList.add("countdown")
            schedule.innerHTML = "initializing"
            add_countdown(timer.id, schedule, timer.schedule)
            outerGrid.appendChild(schedule)
            const wrapper = document.createElement("span");
            const checkbox = document.createElement("input")
            checkbox.type = "checkbox"
            checkbox.name = timer.id
            checkbox.checked = timer.enabled
            wrapper.addEventListener("click", () => {
                const new_state = !checkbox.checked
                const timer_name = checkbox.name
                update_timer(timer_name, undefined, new_state, undefined);
            });
            const icon = document.createElement("i")
            icon.classList.add("icon")
            icon.setAttribute("data-feather", checkbox.checked ? "check-square" : "square");
            wrapper.append(checkbox)
            wrapper.append(icon)
            outerGrid.appendChild(wrapper)
            const timerEdit = document.createElement("div")
            const timerWrapper = document.createElement("span")
            const timerEditIcon = document.createElement("i")
            timerEditIcon.classList.add("icon")
            timerEditIcon.setAttribute("data-feather", "edit");
            timerWrapper.appendChild(timerEditIcon)
            timerWrapper.addEventListener("click", () => {
                show_timer_edit_dialog(timer, rules)
            })
            timerEdit.appendChild(timerWrapper)
            outerGrid.appendChild(timerEdit)
        }
    }
    apply_feather(content)
}

const show_timer_edit_dialog = (timer, rules) => {
    const template = document.getElementById("template-edit-timer")
    if(!template) {
        console.warn("No template found")
        return null
    }

    const e = template.content.cloneNode(true)
    const timer_id = e.querySelector("input[name=timer-id]")
    timer_id.value = timer.id
    const timer_schedule = e.querySelector("input[name=timer-schedule]")
    let timezone_offset = new Date(Date.now()).getTimezoneOffset() // default is Browser's timezone
    if(timer.schedule) {
        const js_date = new Date(timer.schedule)
        timezone_offset = js_date.getTimezoneOffset()
        const timezone_corrected_date = new Date(js_date.getTime() - (js_date.getTimezoneOffset() * 60000))
        timer_schedule.value = timezone_corrected_date.toISOString().slice(0, 16)
    }
    const timer_enabled = e.querySelector("select[name=timer-enabled]")
    timer_enabled.options[timer.enabled ? 0: 1].selected = true
    const timer_rule = e.querySelector("select[name=timer-rule]")
    Object.entries(rules).forEach(rule => {
        const element = document.createElement("option")
        element.value = rule[1]
        element.text = rule[0]
        element.selected = rule[1] === timer.rule_id
        timer_rule.add(element)
    })

    e.querySelector('button[name=button-accept]').addEventListener("click", (btn) => {
        btn.preventDefault()
        // todo: timer rules and more
        const timer_schedule = overlay.querySelector("input[name=timer-schedule]")
        const new_date = new Date(timer_schedule.value +"+"+(timezone_offset / -60).toString().padStart(2, '0')+":00")
        console.log(new_date, timer_enabled.value)
        const rule_id = overlay.querySelector("select[name=timer-rule]").value
        const timer_id = overlay.querySelector("input[name=timer-id]").value
        update_timer(timer_id, new_date.toISOString(), timer_enabled.value==="1", rule_id,  {})
        overlay.style.display = 'none';
        overlay.parentNode.removeChild(overlay);
    })
    e.querySelector('button[name=button-reject]').addEventListener("click", (btn) => {
        btn.preventDefault()
        overlay.style.display = 'none';
        overlay.parentNode.removeChild(overlay);
    })
    const overlay = document.createElement("div")
    overlay.classList.add("overlay")
    overlay.appendChild(e)
    document.getElementsByTagName('body')[0].appendChild(overlay);

}

const update_timer = (timer_name, schedule = undefined, enabled = undefined, rule_id = undefined, data = undefined) => {
    /*

  {
    "id": "Request Shelly announces",
    "schedule": "2025-02-10T16:38:14.576916+01:00",
    "enabled": true,
    "data": {
      "__interval__": 86400,
      "kwargs": {}
    }
  }

     */
    if(!(timer_name)) {
        console.error("Timer name not given")
        return
    }
    const timer_dict = {"id": timer_name}
    timer_dict["schedule"] = schedule
    timer_dict["enabled"] = enabled
    timer_dict["rule_id"] = rule_id
    timer_dict["data"] = data


    socket.send(JSON.stringify({
        type: "timer",
        data: timer_dict
    }))
}

const flash = (message, type = "success", actions = []) => {
    const root = document.createElement("div")
    root.classList.add("flash")
    root.classList.add("flash-" + type)

    const messageElement = document.createElement("span")
    messageElement.innerText = message
    messageElement.classList.add("flash-message")

    const closeFlash = () => {
        root.style.display = "none"
        root.parentElement?.removeChild(root)
    }

    const closeButton = document.createElement("button")
    closeButton.addEventListener("click", closeFlash)
    closeButton.classList.add("flash-close-button")
    closeButton.innerHTML = '<i class="feather" data-feather="x"></i>'

    root.appendChild(messageElement)

    if(actions.length) {
        actions.forEach((action) => {
            const button = document.createElement("button")
            button.addEventListener("click", (e) => {
                if(action.action)
                    action.action()
                closeFlash()
            })
            if(action.feather) {
                button.innerHTML = `<i class="feather" data-feather="${action.feather}"></i>` + action.text
            } else {
                button.textContent = action.text
            }
            root.appendChild(button)
        })
    } else {
        setTimeout(closeFlash, 3000);
    }
    root.appendChild(closeButton)
    apply_feather(root)

    document.getElementById("flash").appendChild(root)
}

const handle_message_things = (data) => {
    data.things.forEach(thing => {
        if(thing.id in things && things[thing.id].element) {
            const e = document.getElementById('thing-' + thing.id);
            e.querySelector('.thing-name span[name="name"]').innerText = thing.name;
            const currentView = decodeURI(window.location.hash.substr(1));
            e.classList.toggle("invisible", !views[currentView].includes(thing.id) || !thing.visible);

            thing.element = e;
            things[thing.id] = thing;
            return;
        }
        let element = create_thing_element(thing);
        thing.element = element;
        things[thing.id] = thing;
    });
};

const handle_message_states = (data) => {
    data.states.forEach((state) => {
        if(!state.thing_id in things) {
            console.warn("Got state for unknown thing", state.thing_id);
            return;
        }
        let thing = things[state.thing_id];
        if(thing)
            update_thing_state(thing, state);
    });
};

const handle_message_views = (data) => {
    document.querySelectorAll(".thing-view").forEach((e) => { e.remove() });
    current_view = ""
    views = {}

    for(let [name, things] of Object.entries(data.views)) {
        let li = document.createElement("li");
        li.id = "view-" + name;
        li.classList.add("menu-item");
        li.classList.add("thing-view");
        let a = document.createElement("a");
        a.href = "#" + name;
        a.innerText = name;
        li.appendChild(a);
        li.addEventListener("click", () => { show_view(name);})
        document.querySelector("#bar").appendChild(li);
        views[name] = things;
    }
    let saved_view = decodeURI(window.location.hash.substr(1));
    if(!saved_view)
        saved_view = Object.entries(views)[0][0];
    show_view(saved_view);
};

const handle_message_last_seen = (data) => {
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
};

const handle_message_edit_data = (data) => {
    if(data.kind === "thing") {
        current_overlay = show_thing_edit_dialog(data.data);
        document.getElementsByTagName('body')[0].appendChild(current_overlay);
    }
};

const handle_message_edit_ok = (data) => {
    if(!current_overlay)
        return;

    current_overlay.parentNode.removeChild(current_overlay);
    current_overlay = null;
    flash("Thing successfully saved.")
};

const handle_message_cookie = (data) => {
    document.cookie = `auth=${data.value};max-age=${data.max_age}`;
};

const handle_message_auth_required = (data) => {
    flash("You need to login to use this function.", "error", [{text: "Login", action: show_login_dialog}]);
};

const handle_message_auth_ok = (data) => {
    if(current_overlay) {
        current_overlay.parentNode.removeChild(current_overlay);
        current_overlay = null;
        flash("Login succeded.")
    }
    const authenticated = data.level >= 2
    document.getElementById("login").classList.toggle("invisible", authenticated);
    document.getElementById("logout").classList.toggle("invisible", !authenticated);
    document.getElementById("settings").classList.toggle("invisible", !authenticated);
    document.getElementById("rules").classList.toggle("invisible", !authenticated);
    document.getElementById("timers").classList.toggle("invisible", !authenticated);
};

const handle_message_auth_failed = (data) => {
    if(current_overlay) {
        current_overlay.parentNode.removeChild(current_overlay);
        current_overlay = null;
    }
    flash("Login failed.", "error", [{text: "Login", action: show_login_dialog}]);
};

const handle_message_rules = (data) => {
    update_rules_dialog(data.value);
};

const handle_message_timers = (data) => {
    update_timers_dialog(data.value, data.rules);
};

const handle_message_msg = (data) => {
    flash(data.value);
};

let handle_message = (data) => {
    const handlers = {
        things: handle_message_things,
        states: handle_message_states,
        views: handle_message_views,
        last_seen: handle_message_last_seen,
        edit_data: handle_message_edit_data,
        edit_ok: handle_message_edit_ok,
        cookie: handle_message_cookie,
        auth_required: handle_message_auth_required,
        auth_ok: handle_message_auth_ok,
        auth_failed: handle_message_auth_failed,
        rules: handle_message_rules,
        timers: handle_message_timers,
        msg: handle_message_msg,
    }

    if(!handlers[data.type]) {
        console.error(`Unimplemented message type: "${data.type}".`);
        return;
    }

    try {
        handlers[data.type](data);
    } catch(e) {
        console.error(`Handler for "${data.type}" failed:`, e);
    }
};

let set_status = (msg) => {
    const e = document.getElementById("status");
    e.innerHTML = msg;
    //e.innerText = msg;
};

let get_last_seen = () => {
    if(socket.readyState !== WS_OPEN) {
        return;
    }

    socket.send(JSON.stringify({type: "last_seen"}));
};

const last_seen_warning_interval = 3 * 60 * 1000;
const get_last_seen_interval = 30 * 1000;
let reconnect_attempt = 0;
let current_last_seen_timeout_id = null;

let ws_connect = () => {
    const make_ws_url = () => {
        const l = window.location;
        const c = config;
        return (c.ws_proto || l.protocol.replace("http", "ws")) + "//"
            + (c.ws_host || l.hostname)
            + ((c.ws_port ? ":" + c.ws_port : undefined) || (l.port ? ":" + l.port : ""))
            + c.ws_path;
    };

    socket = new WebSocket(make_ws_url());

    socket.addEventListener("open", function(event) {
        console.log("Connected");
        set_status('<svg class="feather feather-fill"><use href="img/feather-sprite.svg#cloud"/></svg>');
        reconnect_attempt = 0;

        if(current_last_seen_timeout_id) {
            clearTimeout(current_last_seen_timeout_id);
            current_last_seen_timeout_id = null;
        }

        get_last_seen();
    });

    socket.addEventListener("close", function(event) {
        set_status('<svg class="feather feather-fill"><use href="img/feather-sprite.svg#cloud-off"/></svg>');

        if(document.hidden) {
            return;
        }

        const time = 1000 + reconnect_attempt*1000;
        const status_str = "Disconnected. Trying to reconnect in "+ time/1000 + " seconds.";
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
    apply_feather(document.querySelector('#bar'));
    document.querySelector(".toggle a").addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll(".menu-item").forEach((item) => {
            if(!item.style.display || item.style.display === "none") {
                item.style.display = "block";
            } else {
                item.style.display = "none";
            }
        });
    });
    document.querySelector('#settings').addEventListener('click', (e) => {
        show_thing_edit(!edit_mode_active);
    });
    document.querySelector('#login').addEventListener('click', show_login_dialog);
    document.querySelector('#logout').addEventListener('click', (e) => {
        document.cookie = "auth=";
        location.reload()
    });
    document.querySelector('#rules').addEventListener('click', (e) => {
        show_rules()
    })
    document.querySelector('#timers').addEventListener('click', (e) => {
        show_timers()
    })
});

document.addEventListener('visibilitychange', () => {
    if(!socket) {
        return;
    }

    const hidden = document.hidden;
    console.info("Page visibility changed", !hidden);
    const state = socket.readyState;
    if(hidden && state <= WS_OPEN) {
        socket.close(1000);
    } else if(!hidden && state === WS_CLOSED) {
        ws_connect();
    }
}, false);

if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('js/worker.js');
};
