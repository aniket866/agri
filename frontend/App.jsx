import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import "./App.css";
import Advisor from "./Advisor";
import Home from "./Home";
import How from "./How";
import "./App.css";
import { FaLeaf, FaHome, FaComments, FaInfoCircle, FaTimes, FaBars } from "react-icons/fa";


const LANGUAGE_OPTIONS = [
  { value: "en", label: "🌍 English" },
  { value: "hi", label: "🇮🇳 हिंदी" },
  { value: "mr", label: "🇮🇳 मराठी" },
  { value: "bn", label: "🇮🇳 বাংলা" },
  { value: "ta", label: "🇮🇳 தமிழ்" },
  { value: "te", label: "🇮🇳 తెలుగు" },
  { value: "gu", label: "🇮🇳 ગુજરાતી" },
  { value: "pa", label: "🇮🇳 ਪੰਜਾਬੀ" },
  { value: "kn", label: "🇮🇳 ಕನ್ನಡ" },
  { value: "ml", label: "🇮🇳 മലയാളം" },
  { value: "or", label: "🇮🇳 ଓଡ଼ିଆ" },
  { value: "as", label: "🇮🇳 অসমীয়া" },
];

const getInitialPreferredLanguage = () => {
  try {
    const storedLanguage = localStorage.getItem("preferredLanguage");
    return LANGUAGE_OPTIONS.some((option) => option.value === storedLanguage)
      ? storedLanguage
      : "en";
  } catch {
    return "en";
  }
};

const applyLanguageToGoogleTranslate = (language) => {
  const gtCombo = document.querySelector(".goog-te-combo");
  if (!gtCombo) {
    return false;
  }

  gtCombo.value = language;
  gtCombo.dispatchEvent(new Event("change"));
  return true;
};

const syncPreferredLanguage = (language, setPreferredLang) => {
  setPreferredLang(language);
  localStorage.setItem("preferredLanguage", language);
  applyLanguageToGoogleTranslate(language);
};


function App() {
  const [preferredLang, setPreferredLang] = useState(getInitialPreferredLanguage);
  const [isOpen, setIsOpen] = useState(false);
  const [sunlight, setSunlight] = useState(false);

  const getInitialTheme = () => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      // ignore
    }
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  const [theme, setTheme] = useState(getInitialTheme);

  const [name, setName] = useState(localStorage.getItem("farmerName") || "");
  const [inputName, setInputName] = useState("");


  const handleLogin = (e) => {
    e.preventDefault();

    if (!inputName.trim()) {
      alert("Name is required");
      return;
    }

    localStorage.setItem("farmerName", inputName);

    setName(inputName);

    setInputName("");
    window.location.href = "/";
  };

  const handleLogout = () => {
    localStorage.removeItem("farmerName");
    setName("");
    window.location.href = "/";
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("theme-dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    if (applyLanguageToGoogleTranslate(preferredLang)) {
      return;
    }

    let attempts = 0;
    const maxAttempts = 20;
    const retryId = window.setInterval(() => {
      attempts += 1;
      const applied = applyLanguageToGoogleTranslate(preferredLang);
      if (applied || attempts >= maxAttempts) {
        window.clearInterval(retryId);
      }
    }, 300);

    return () => {
      window.clearInterval(retryId);
    };
  }, [preferredLang]);

  return (
    <Router>
      <div className={sunlight ? "app sunlight" : "app"}>

        {/* Navbar */}
        {/* NAVBAR */}
        <nav className="navbar">
          <div className="nav-left">
            <FaLeaf className="icon" />
            <Link to="/" className="brand">
              Fasal Saathi
            </Link>
          </div>

          <ul className={`nav-center ${isOpen ? "active" : ""}`}>
            <li>
              <Link to="/" onClick={() => setIsOpen(false)}>
                <FaHome className="icon" /> Home
              </Link>
            </li>
            <li>
              <Link to="/advisor" onClick={() => setIsOpen(false)}>
                <FaComments className="icon" /> Chat
              </Link>
            </li>
            <li>
              <Link to="/how-it-works" onClick={() => setIsOpen(false)}>
                <FaInfoCircle className="icon" /> How It Works
              </Link>
            </li>
          </ul>

          <div className="nav-right">
            <button
              type="button"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="theme-toggle"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={theme === "dark"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>

            <button
              onClick={() => setSunlight(!sunlight)}
              className="sunlight-toggle"
              aria-label="Toggle high contrast mode"
              aria-pressed={sunlight}
            >
              {sunlight ? "Normal Contrast" : "High Contrast"}
            </button>

            {/* Language Dropdown */}
            {/* LANGUAGE SELECT */}
            <select
              className="lang-select"
              value={preferredLang}
              onChange={(e) => {
                syncPreferredLanguage(e.target.value, setPreferredLang);
              }}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {/* USER */}
            <div className="nav-user">
              {name ? (
                <>
                  👋 Welcome, {name}!
                  <button className="logout-btn" onClick={handleLogout}>
                    Logout
                  </button>
                </>
              ) : (
                <Link to="/login" onClick={() => setIsOpen(false)}>
                  Login
                </Link>
              )}
            </div>
          </div>

          <button className="hamburger" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <FaTimes /> : <FaBars />}
          </button>
        </nav>

        {/* ROUTES */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/advisor" element={<Advisor />} />
          <Route path="/how-it-works" element={<How />} />

          <Route
            path="/login"
            element={
              <div className="login-page">
                <div className="login-card">
                  <h2>👨‍🌾 Farmer Login</h2>

                  <form onSubmit={handleLogin}>
                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={inputName}
                      onChange={(e) => setInputName(e.target.value)}
                    />

                    <select
                      value={preferredLang}
                      onChange={(e) => {
                        syncPreferredLanguage(e.target.value, setPreferredLang);
                      }}
                      style={{ marginBottom: "18px" }}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <button type="submit">Login</button>
                  </form>
                </div>
              </div>
            }
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
