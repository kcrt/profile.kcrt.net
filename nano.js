/*! nano.js — optional helpers for nano.css components by kcrt | MIT License */
"use strict";

// Close the collapsed .navbar menu after following one of its links,
// so the target section isn't hidden behind the open menu.
document.querySelectorAll(".navbar").forEach((navbar) => {
	const toggle = navbar.querySelector(".navbar-toggle");
	if (!(toggle instanceof HTMLInputElement)) {
		return;
	}
	navbar.querySelectorAll(".navbar-menu a").forEach((link) => {
		link.addEventListener("click", () => {
			toggle.checked = false;
		});
	});
});
