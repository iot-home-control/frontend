/*
Modified from https://github.com/ar5had/anywidth-js-tooltip for manual tooltip
initalization and some clean-up.

Original License:
MIT License

Copyright (c) 2016 Arshad Khan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function () {

    window.setup_tooltip = function setup_tooltip(element) {
        element.addEventListener("mouseenter", function () {
            const target = this;
            const tip = target.getAttribute("title");
            let tooltip = document.createElement("div");
            tooltip.id = "tooltip";

            if (!tip || tip == "")
                return false;

            target.removeAttribute("title");
            tooltip.style.opacity = 0;
            tooltip.innerHTML = tip;
            document.body.appendChild(tooltip);

            var init_tooltip = function () {
                function getOffset(elem) {
                    var offsetLeft = 0, offsetTop = 0;
                    do {
                        if (!isNaN(elem.offsetLeft)) {
                            offsetLeft += elem.offsetLeft;
                            offsetTop += elem.offsetTop;
                        }
                    } while (elem = elem.offsetParent);
                    return { left: offsetLeft, top: offsetTop };
                }

                // set width of tooltip to half of window width
                if (window.innerWidth < tooltip.offsetWidth * 1.5)
                    tooltip.style.maxWidth = window.innerWidth / 2;
                else {
                    tooltip.style.maxWidth = 340;
                }

                var pos_left = getOffset(target).left + (target.offsetWidth / 2) - (tooltip.offsetWidth / 2),
                    pos_top = getOffset(target).top - tooltip.offsetHeight - 10;
                if (pos_left < 0) {
                    pos_left = getOffset(target).left + target.offsetWidth / 2 - 20;
                    tooltip.classList.add("left");
                }
                else {
                    tooltip.classList.remove("left");
                }

                if (pos_left + tooltip.offsetWidth > window.innerWidth) {
                    pos_left = getOffset(target).left - tooltip.offsetWidth + target.offsetWidth / 2 + 20;
                    tooltip.classList.add("right");
                }
                else {
                    tooltip.classList.remove("right");
                }

                if (pos_top < 0) {
                    var pos_top = getOffset(target).top + target.offsetHeight + 15;
                    tooltip.classList.add("top");
                }
                else {
                    tooltip.classList.remove("top");
                }

                // adding "px" is very important
                tooltip.style.left = pos_left + "px";
                tooltip.style.top = pos_top + "px";
                tooltip.style.opacity = 1;
            };

            init_tooltip();
            window.addEventListener("resize", init_tooltip);

            window.remove_tooltip = function () {
                tooltip.style.opacity = 0;
                document.querySelector("#tooltip") && document.body.removeChild(document.querySelector("#tooltip"));
                target.setAttribute("title", tip);
            };

            target.addEventListener("mouseleave", window.remove_tooltip);
            tooltip.addEventListener("click", window.remove_tooltip);
        });
    }
})();