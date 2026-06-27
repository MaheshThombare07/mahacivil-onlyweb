/**
 * MahaCivil — Realtime Database login (no Firebase Auth)
 * Users stored at users/{mobile} with name, password, and usage flags.
 */
(function (global) {
    const firebaseConfig = {
        apiKey: "AIzaSyB-tnNXzhUw12FmOoLdWNxxBdIk58sviRE",
        databaseURL: "https://maha-civil-8044b-default-rtdb.firebaseio.com",
        projectId: "maha-civil-8044b",
        storageBucket: "maha-civil-8044b.firebasestorage.app",
        messagingSenderId: "742994502145",
        appId: "1:742994502145:web:7754e37c9b9f599d5c5600"
    };

    const SESSION_KEY = "mahacivil_mobile";

    let db = null;
    let initialized = false;
    let registerMode = false;
    let pendingCallback = null;
    let isSubmitting = false;

    function init() {
        if (initialized || typeof firebase === "undefined") return;
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.database();
        initialized = true;
    }

    function $(id) {
        return document.getElementById(id);
    }

    function sanitizeMobile(mobile) {
        return String(mobile || "").replace(/\D/g, "");
    }

    function isValidMobile(mobile) {
        return sanitizeMobile(mobile).length === 10;
    }

    function isValidPassword(password) {
        return password.length >= 3;
    }

    function getSessionMobile() {
        try {
            return localStorage.getItem(SESSION_KEY) || "";
        } catch (_) {
            return "";
        }
    }

    function saveSession(mobile) {
        try {
            if (mobile) {
                localStorage.setItem(SESSION_KEY, mobile);
            } else {
                localStorage.removeItem(SESSION_KEY);
            }
        } catch (_) { /* ignore */ }
    }

    function mapDbError(error) {
        const msg = (error && error.message) || "";
        if (/permission denied/i.test(msg)) {
            return "Cannot access database. Check Firebase Realtime Database rules.";
        }
        if (/network/i.test(msg)) return "Network error. Please check your internet connection";
        return msg || "Something went wrong. Please try again.";
    }

    async function login(mobile, password) {
        init();
        const cleanMobile = sanitizeMobile(mobile);
        if (!isValidMobile(cleanMobile)) throw new Error("Enter a valid 10-digit mobile number");
        if (!isValidPassword(password)) throw new Error("Password must be at least 3 characters");

        const snapshot = await db.ref("users/" + cleanMobile).once("value");
        if (!snapshot.exists()) {
            throw new Error("Account not found. Please create a new account");
        }

        const data = snapshot.val() || {};
        if (data.password !== password) {
            throw new Error("Incorrect mobile number or password");
        }

        saveSession(cleanMobile);
    }

    async function register(name, mobile, password) {
        init();
        const cleanName = String(name || "").trim();
        const cleanMobile = sanitizeMobile(mobile);
        if (!cleanName) throw new Error("Please enter your name");
        if (!isValidMobile(cleanMobile)) throw new Error("Enter a valid 10-digit mobile number");
        if (!isValidPassword(password)) throw new Error("Password must be at least 3 characters");

        const userRef = db.ref("users/" + cleanMobile);
        const existing = await userRef.once("value");
        if (existing.exists()) {
            throw new Error("This mobile number is already registered");
        }

        const profile = {
            name: cleanName,
            mobile: cleanMobile,
            password: password,
            usedCalculator: false,
            usedEasar: false,
            usedDpMaps: false,
            usedContact: false,
            createdAt: Date.now()
        };

        await userRef.set(profile);
        saveSession(cleanMobile);
    }

    function isLoggedIn() {
        return !!getSessionMobile();
    }

    async function markFeatureUsed(featureKey) {
        init();
        const mobile = getSessionMobile();
        if (!mobile || !db) return;
        try {
            await db.ref("users/" + mobile + "/" + featureKey).set(true);
        } catch (_) { /* non-blocking */ }
    }

    function formatMobileDisplay(mobile) {
        const digits = sanitizeMobile(mobile);
        if (digits.length === 10) {
            return "+91 " + digits.slice(0, 5) + " " + digits.slice(5);
        }
        return digits;
    }

    function closeAccountDropdown() {
        const dropdown = $("account-dropdown");
        const btn = $("account-btn");
        if (dropdown) dropdown.classList.add("hidden");
        if (btn) btn.setAttribute("aria-expanded", "false");
    }

    function toggleAccountDropdown() {
        const dropdown = $("account-dropdown");
        const btn = $("account-btn");
        if (!dropdown || !btn) return;
        const isOpen = dropdown.classList.toggle("hidden");
        btn.setAttribute("aria-expanded", String(!isOpen));
    }

    function updateAccountUI() {
        const wrap = $("header-account");
        const mobileEl = $("account-mobile-display");
        const mobile = getSessionMobile();
        if (!wrap) return;

        if (mobile) {
            wrap.classList.remove("hidden");
            if (mobileEl) mobileEl.textContent = formatMobileDisplay(mobile);
        } else {
            wrap.classList.add("hidden");
            if (mobileEl) mobileEl.textContent = "";
            closeAccountDropdown();
        }
    }

    function bindAccountEvents() {
        const btn = $("account-btn");
        const logoutBtn = $("account-logout-btn");

        if (btn) {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleAccountDropdown();
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener("click", () => {
                saveSession(null);
                updateAccountUI();
            });
        }

        document.addEventListener("click", (e) => {
            const wrap = $("header-account");
            if (wrap && !wrap.classList.contains("hidden") && !wrap.contains(e.target)) {
                closeAccountDropdown();
            }
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeAccountDropdown();
        });
    }

    function setAuthError(message) {
        const el = $("auth-error");
        if (!el) return;
        if (message) {
            el.textContent = message;
            el.classList.remove("hidden");
        } else {
            el.textContent = "";
            el.classList.add("hidden");
        }
    }

    function setRegisterMode(enabled) {
        registerMode = enabled;
        const nameGroup = $("auth-name-group");
        const title = $("auth-modal-title");
        const subtitle = $("auth-modal-subtitle");
        const submitBtn = $("auth-submit-btn");
        const toggleBtn = $("auth-toggle-btn");
        const lang = global.__lang || "en";

        if (nameGroup) nameGroup.classList.toggle("hidden", !enabled);
        if (title) title.textContent = enabled ? t("authCreateTitle", lang) : t("authLoginTitle", lang);
        if (subtitle) subtitle.textContent = enabled ? t("authCreateSubtitle", lang) : t("authLoginSubtitle", lang);
        if (submitBtn) submitBtn.textContent = enabled ? t("authCreateBtn", lang) : t("authLoginBtn", lang);
        if (toggleBtn) {
            toggleBtn.textContent = enabled ? t("authHaveAccount", lang) : t("authCreateAccount", lang);
        }
        setAuthError(null);
    }

    function clearAuthForm() {
        const name = $("auth-name");
        const mobile = $("auth-mobile");
        const password = $("auth-password");
        if (name) name.value = "";
        if (mobile) mobile.value = "";
        if (password) password.value = "";
        setAuthError(null);
    }

    function showAuthModal(onSuccess) {
        pendingCallback = onSuccess;
        setRegisterMode(false);
        clearAuthForm();
        const modal = $("auth-modal");
        if (modal) {
            modal.classList.remove("hidden");
            document.body.classList.add("dialog-open");
            setTimeout(() => {
                const focusEl = registerMode ? $("auth-name") : $("auth-mobile");
                if (focusEl) focusEl.focus();
            }, 50);
        }
    }

    function hideAuthModal() {
        const modal = $("auth-modal");
        if (modal) modal.classList.add("hidden");
        document.body.classList.remove("dialog-open");
        pendingCallback = null;
        isSubmitting = false;
        const submitBtn = $("auth-submit-btn");
        if (submitBtn) submitBtn.disabled = false;
    }

    async function handleSubmit() {
        if (isSubmitting) return;
        setAuthError(null);

        const name = ($("auth-name") && $("auth-name").value) || "";
        const mobile = ($("auth-mobile") && $("auth-mobile").value) || "";
        const password = ($("auth-password") && $("auth-password").value) || "";

        isSubmitting = true;
        const submitBtn = $("auth-submit-btn");
        if (submitBtn) submitBtn.disabled = true;

        try {
            if (registerMode) {
                await register(name, mobile, password);
            } else {
                await login(mobile, password);
            }
            const cb = pendingCallback;
            hideAuthModal();
            updateAccountUI();
            if (typeof cb === "function") cb();
        } catch (err) {
            setAuthError(mapDbError(err));
        } finally {
            isSubmitting = false;
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    function requireAuth(onSuccess) {
        init();
        if (isLoggedIn()) {
            onSuccess();
            return;
        }
        showAuthModal(onSuccess);
    }

    function bindModalEvents() {
        const closeBtn = $("auth-modal-close");
        const backdrop = $("auth-modal-backdrop");
        const submitBtn = $("auth-submit-btn");
        const toggleBtn = $("auth-toggle-btn");
        const mobileInput = $("auth-mobile");

        if (closeBtn) closeBtn.addEventListener("click", hideAuthModal);
        if (backdrop) backdrop.addEventListener("click", hideAuthModal);
        if (submitBtn) submitBtn.addEventListener("click", handleSubmit);
        if (toggleBtn) {
            toggleBtn.addEventListener("click", () => {
                setRegisterMode(!registerMode);
                clearAuthForm();
            });
        }
        if (mobileInput) {
            mobileInput.addEventListener("input", (e) => {
                e.target.value = sanitizeMobile(e.target.value).slice(0, 10);
            });
        }

        document.addEventListener("keydown", (e) => {
            const modal = $("auth-modal");
            if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
                hideAuthModal();
            }
        });
    }

    function refreshAuthI18n() {
        setRegisterMode(registerMode);
    }

    global.MahaAuth = {
        init,
        isLoggedIn,
        requireAuth,
        markFeatureUsed,
        refreshAuthI18n,
        updateAccountUI,
        logout() {
            saveSession(null);
            updateAccountUI();
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            init();
            bindModalEvents();
            bindAccountEvents();
            updateAccountUI();
        });
    } else {
        init();
        bindModalEvents();
        bindAccountEvents();
        updateAccountUI();
    }
})(window);
