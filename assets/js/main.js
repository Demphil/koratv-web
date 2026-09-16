// main.js
document.addEventListener('DOMContentLoaded', () => {
    setupMobileMenu();
    highlightActiveLink();
});

function setupMobileMenu() {
    const menuToggle = document.getElementById('menuToggle');
    const nav = document.querySelector('.nav ul');

    if (menuToggle && nav) {
        menuToggle.addEventListener('click', () => {
            nav.classList.toggle('open');
        });
    }
}

function highlightActiveLink() {
    const links = document.querySelectorAll('nav ul li a');
    links.forEach(link => {
        if (link.href === window.location.href) {
            link.classList.add('active');
        }
    });
}// main.js
document.addEventListener('DOMContentLoaded', () => {
    setupMobileMenu();
    highlightActiveLink();
});

function setupMobileMenu() {
    const menuToggle = document.getElementById('menuToggle');
    const nav = document.querySelector('.nav ul');

    if (menuToggle && nav) {
        menuToggle.addEventListener('click', () => {
            nav.classList.toggle('open');
        });
    }
}

function highlightActiveLink() {
    const links = document.querySelectorAll('nav ul li a');
    links.forEach(link => {
        if (link.href === window.location.href) {
            link.classList.add('active');
        }
    });
}  
