import React, { useEffect, useState, useRef } from "react";
import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useFloating, flip, shift, offset, autoUpdate } from "@floating-ui/react";
import {
  FaComments,
  FaLeaf,
  FaTachometerAlt,
  FaTimes,
  FaBars,
  FaChevronDown,
  FaChevronUp,
  FaWhatsapp,
  FaInfoCircle,
  FaBook,
  FaShieldAlt,
  FaBolt,
  FaUserSecret,
  FaFileInvoiceDollar,
  FaHome,
  FaSun,
  FaMoon,
} from "react-icons/fa";
import { usePerformanceStore } from "./stores/performanceStore";
import { useAuthStore } from "./stores/authStore";
import { useUiStore } from "./stores/uiStore";

// Components - Lazily Loaded for better bundle size
const AdminFeedback = React.lazy(() => import("./AdminFeedback"));
const Advisor = React.lazy(() => import("./Advisor"));
const Auth = React.lazy(() => import("./Auth"));
const Calendar = React.lazy(() => import("./FarmingCalendar"));
const Contributors = React.lazy(() => import("./Contributors"));
const CropGuide = React.lazy(() => import("./CropGuide"));
const CropProfitCalculator = React.lazy(() => import("./CropProfitCalculator"));
const Dashboard = React.lazy(() => import("./Dashboard"));
const Feedback = React.lazy(() => import("./Feedback"));
const FarmingMap = React.lazy(() => import("./FarmingMap"));
const Schemes = React.lazy(() => import("./GovernmentSchemes"));
const How = React.lazy(() => import("./How"));
const Home = React.lazy(() => import("./Home"));
const MarketPrices = React.lazy(() => import("./MarketPrices"));
const Community = React.lazy(() => import("./Community"));
const ContactUs = React.lazy(() => import("./ContactUs"));
const AboutUs = React.lazy(() => import("./AboutUs"));
const LanguageDropdown = React.lazy(() => import("./LanguageDropdown"));
const ProfileSetup = React.lazy(() => import("./ProfileSetup"));
const QRTraceability = React.lazy(() => import("./QRTraceability"));
const Resources = React.lazy(() => import("./Resources"));
const SeasonalCropPlanner = React.lazy(() => import("./SeasonalCropPlanner"));
const SoilGuide = React.lazy(() => import("./SoilGuide"));
const CropDiseaseAwareness = React.lazy(() => import("./CropDiseaseAwareness"));
const CropRotation = React.lazy(() => import("./CropRotation"));
const Helpline = React.lazy(() => import("./Helpline"));
const Glossary = React.lazy(() => import("./Glossary"));
const RiskIndex = React.lazy(() => import("./RiskIndex"));
const Blog = React.lazy(() => import("./Blog"));
const BlogDetail = React.lazy(() => import("./BlogDetail"));
const FAQ = React.lazy(() => import("./FAQ"));
const NotFound = React.lazy(() => import("./NotFound"));
const PrivacyPolicy = React.lazy(() => import("./PrivacyPolicy"));
const Terms = React.lazy(() => import("./Terms"));
const SoilAnalysis = React.lazy(() => import("./SoilAnalysis"));
const SeedVerifier = React.lazy(() => import("./SeedVerifier"));
const FarmFinance = React.lazy(() => import("./FarmFinance"));
const YieldPredictor = React.lazy(() => import("./YieldPredictor"));

// Keep critical components synchronous
import Loader from "./Loader";
import useNotifications from "./Notifications";
import Footer from "./components/Footer";
import { SkipLink } from "./NavigationManager";
import { useTheme } from "./ThemeContext";
import ErrorBoundary from "./ErrorBoundary";

// Libs
import { auth, db, isFirebaseConfigured, doc, onSnapshot, setDoc } from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";

// CSS
import "./App.css";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "🌍 English", englishName: "english" },
  { value: "hi", label: "🇮🇳 हिंदी", englishName: "hindi" },
  { value: "mr", label: "🇮🇳 मराठी", englishName: "marathi" },
  { value: "bn", label: "🇮🇳 বাংলা", englishName: "bengali" },
  { value: "ta", label: "🇮🇳 தமிழ்", englishName: "tamil" },
  { value: "te", label: "🇮🇳 తెలుగు", englishName: "telugu" },
  { value: "gu", label: "🇮🇳 ગુજરાતી", englishName: "gujarati" },
  { value: "pa", label: "🇮🇳 ਪੰਜਾਬੀ", englishName: "punjabi" },
  { value: "kn", label: "🇮🇳 ಕನ್ನಡ", englishName: "kannada" },
  { value: "ml", label: "🇮🇳 മലയാളം", englishName: "malayalam" },
  { value: "or", label: "🇮🇳 ଓଡ଼ିଆ", englishName: "odia" },
  { value: "as", label: "🇮🇳 অসমীয়া", englishName: "assamese" },
];

const getInitialLanguage = () => {
  // Always default to English when the user enters the site
  return "en";
};

/**
 * Helper to apply Google Translate selection to the hidden widget
 */
const applyGoogleTranslate = (langCode) => {
  try {
    const select = document.querySelector(".goog-te-combo");
    if (select) {
      if (select.value !== langCode) {
        select.value = langCode;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }
  } catch (e) {
    console.error("GT Apply Error:", e);
  }
  return false;
};

const GuestBanner = ({ onSignUp }) => (
  <div className="guest-banner">
    <div className="guest-banner-content">
      <FaUserSecret className="banner-icon" />
      <span>
        <strong>Guest Session Active:</strong> Explore the platform freely! 
        <Link to="/auth" className="banner-link"> Sign Up</Link> to save your progress permanently.
      </span>
    </div>
  </div>
);

function App() {
  const scorecardRef = useRef(null);
  
  // Zustand Stores
  const { user, userData, loading, profileCompleted, setUser, setUserData, setLoading, setProfileCompleted } = useAuthStore();
  const { 
    theme, toggleTheme, preferredLang, setPreferredLang, 
    isNavOpen, setNavOpen, isOffline, setIsOffline,
    showMoreMenu, setShowMoreMenu, showScorecard, setShowScorecard,
    showScrollTop, setShowScrollTop
  } = useUiStore();

  const { liteMode, setLiteMode, detectAndSetLiteMode } = usePerformanceStore();

  useEffect(() => {
    detectAndSetLiteMode();
  }, [detectAndSetLiteMode]);

  const { i18n } = useTranslation();
  const location = useLocation();

  useNotifications();

  /* ---------------- LANGUAGE AUTO-TRANS ---------------- */
  useEffect(() => {
    if (applyGoogleTranslate(preferredLang)) return;
    const id = setInterval(() => {
      if (applyGoogleTranslate(preferredLang)) clearInterval(id);
    }, 300);
    return () => clearInterval(id);
  }, [preferredLang]);

  /* ---------------- AUTH & FIRESTORE SYNC ---------------- */
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }

    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 5000);

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      clearTimeout(safetyTimer);
      setUser(currentUser);
      if (currentUser) {
        const unsubscribeDoc = onSnapshot(doc(db, "users", currentUser.uid), (userDoc) => {
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserData(data);
            setProfileCompleted(data.profileCompleted === true);
          } else if (currentUser.isAnonymous) {
            setUserData({ displayName: "Guest Farmer", isAnonymous: true });
            setProfileCompleted(true);
          } else {
            setUserData(null);
            setProfileCompleted(false);
          }
          setLoading(false);
        }, (error) => {
          console.error("Firestore sync error:", error);
          setLoading(false);
        });
        return () => unsubscribeDoc();
      } else {
        setUserData(null);
        setProfileCompleted(true);
        setLoading(false);
      }
    });
    return () => { clearTimeout(safetyTimer); unsubscribeAuth(); };
  }, [setUser, setUserData, setLoading, setProfileCompleted]);

  // E2EE Key Generation Sync
  useEffect(() => {
    if (!user || !isFirebaseConfigured()) return;

    const ensurePublicKey = async () => {
      try {
        let privateJwk = localStorage.getItem(`agri:ecdh_private_${user.uid}`);
        let publicJwk = localStorage.getItem(`agri:ecdh_public_${user.uid}`);
        
        if (!privateJwk || !publicJwk) {
          const { cryptoService } = await import("./utils/cryptoService");
          const keyPair = await cryptoService.generateECDHKeyPair();
          privateJwk = await cryptoService.exportKey(keyPair.privateKey);
          publicJwk = await cryptoService.exportKey(keyPair.publicKey);
          localStorage.setItem(`agri:ecdh_private_${user.uid}`, JSON.stringify(privateJwk));
          localStorage.setItem(`agri:ecdh_public_${user.uid}`, JSON.stringify(publicJwk));
        } else {
          publicJwk = JSON.parse(publicJwk);
        }

        const pubKeyRef = doc(db, "public_keys", user.uid);
        await setDoc(pubKeyRef, { jwk: publicJwk }, { merge: true });
      } catch (error) {
        console.error("Failed to generate/publish ECDH keys globally:", error);
      }
    };

    ensurePublicKey();
  }, [user]);

  // Online/Offline detection
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setIsOffline]);

  // Scroll to Top logic
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [setShowScrollTop]);

  // Click outside scorecard
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (scorecardRef.current && !scorecardRef.current.contains(event.target)) {
        setShowScorecard(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setShowScorecard]);

  const handleNavToggle = () => setNavOpen(!isNavOpen);
  const handleThemeToggle = toggleTheme;
  const handleLogout = async () => {
    try {
      await signOut(auth);
      window.location.href = "/";
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className={`app ${theme === "dark" ? "theme-dark" : ""} ${liteMode ? "lite-mode" : ""}`}>
      <SkipLink />
      {user?.isAnonymous && <GuestBanner />}

      {loading && <Loader fullPage={true} message={<span className="notranslate">Initializing Fasal Saathi...</span>} />}

      {isOffline && (
        <div className="offline-banner" role="alert">
          You are currently offline. Running in offline mode using local data.
        </div>
      )}

      <nav className={`navbar ${isNavOpen ? "menu-open" : ""}`} role="navigation" aria-label="Main Navigation">
        <div className="nav-left">
          <Link to="/" className="brand">Fasal Saathi</Link>
        </div>

        <ul className={`nav-center ${isNavOpen ? "active" : ""}`}>
          <li><Link to="/" onClick={() => setNavOpen(false)}><FaHome /> Home</Link></li>
          <li><Link to="/advisor" onClick={() => setNavOpen(false)}><FaComments /> Chat</Link></li>
          <li><Link to="/how-it-works" onClick={() => setNavOpen(false)}><FaInfoCircle /> How It Works</Link></li>
          <li><Link to="/crop-guide" onClick={() => setNavOpen(false)}>Crop Guide</Link></li>
          <li><Link to="/resources" onClick={() => setNavOpen(false)}>Resources</Link></li>
        </ul>

        <div className="nav-right">
          <button onClick={handleThemeToggle} className="theme-toggle" aria-label="Toggle Theme">
            {theme === "dark" ? <FaSun className="theme-toggle-icon" /> : <FaMoon className="theme-toggle-icon" />}
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); setShowMoreMenu(!showMoreMenu); }}
            className={`more-menu-toggle ${showMoreMenu ? 'active' : ''}`}
            aria-label="More Options"
          >
            <span className="notranslate">More</span>
            <FaChevronDown className="chevron" />
          </button>

          {showMoreMenu && (
            <div className="more-dropdown" onClick={(e) => e.stopPropagation()} role="menu">
              <div className="dropdown-links">
                <div className="language-selector-section">
                  <label className="language-label">Language:</label>
                  <LanguageDropdown
                    options={LANGUAGE_OPTIONS}
                    value={preferredLang}
                    onChange={(lang) => {
                      setPreferredLang(lang);
                      i18n.changeLanguage(lang);
                      localStorage.setItem("agri:preferredLanguage", lang);
                    }}
                  />
                </div>
                <div className="performance-toggle-section">
                  <button
                    className={`lite-mode-toggle ${liteMode ? 'active' : ''}`}
                    onClick={() => setLiteMode(!liteMode)}
                    role="menuitem"
                  >
                    <div className="toggle-info">
                      <FaBolt className="zap-icon" />
                      <span>Lite Mode {liteMode ? "ON" : "OFF"}</span>
                    </div>
                    <div className="toggle-switch">
                      <div className="switch-handle" />
                    </div>
                  </button>
                </div>
                <Link to="/dashboard" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaTachometerAlt /> Dashboard</Link>
                {userData?.role === "admin" && (
                  <Link to="/admin/feedback" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaShieldAlt /> Feedback Admin</Link>
                )}
                <Link to="/community" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaComments /> Community</Link>
                <Link to="/disease-awareness" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaLeaf /> Awareness</Link>
                <Link to="/risk-index" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaShieldAlt /> Risk Index</Link>
                <Link to="/glossary" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaBook /> Glossary</Link>
                <Link to="/about" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaInfoCircle /> About Us</Link>
                <Link to="/contact" onClick={() => setShowMoreMenu(false)} role="menuitem"><FaInfoCircle /> Contact</Link>
              </div>
            </div>
          )}

          <div className="nav-user" ref={scorecardRef}>
            {!loading && user ? (
              <div className="user-profile-trigger" onClick={() => { setShowScorecard(!showScorecard); setShowMoreMenu(false); }}>
                <div className="profile-main">
                  <span className="profile-name">👋 {userData?.displayName || user.email?.split('@')[0]}</span>
                  <FaChevronDown className={`chevron ${showScorecard ? 'open' : ''}`} />
                </div>

                {showScorecard && userData && (
                  <div className="profile-scorecard" onClick={(e) => e.stopPropagation()}>
                    <div className="scorecard-header">
                      <div className="scorecard-avatar">{userData.displayName?.[0] || 'F'}</div>
                      <h3>{userData.displayName}</h3>
                      <p>{userData.email || user.email}</p>
                    </div>
                    <div className="scorecard-body">
                      {[
                        { label: "🌾 Primary Crop", value: userData.cropType || "N/A" },
                        { label: "🌐 Language", value: LANGUAGE_OPTIONS.find(l => l.value === (userData.language || preferredLang))?.label || preferredLang },
                        { label: "📍 Location", value: userData.address || "Fetching..." }
                      ].map((item, i) => (
                        <div key={i} className="score-item">
                          <label>{item.label}</label>
                          <span>{item.value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="scorecard-footer">
                      <button onClick={handleLogout} className="btn-logout-alt">Sign Out</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" className="btn-get-started">Get Started</Link>
            )}
          </div>
        </div>

        <button className="hamburger" onClick={() => setIsOpen(!isOpen)} aria-label="Toggle Menu">
          {isOpen ? <FaTimes /> : <FaBars />}
        </button>
      </nav>

      {/* VERIFICATION GUARD */}
      {!loading && user && !user.isAnonymous && !user.emailVerified && !showScorecard && location.pathname !== "/login" && (
        <div className="verification-overlay">
          <div className="verification-card">
            <div className="verify-icon">✉️</div>
            <h2>Verify Your Email</h2>
            <p>We've sent a link to <b>{user.email}</b>.<br /> Please verify your email to unlock all features.</p>
            <button 
              onClick={() => {
                auth.currentUser.reload().then(() => window.location.reload());
              }} 
              className="btn-refresh"
            >
              I've Verified My Email
            </button>
            <button onClick={handleLogout} className="btn-logout-simple">Sign Out</button>
          </div>
        </div>
      )}

      {/* PROFILE COMPLETION GUARD */}
      {!loading && user && (user.isAnonymous || user.emailVerified) && !profileCompleted && location.pathname !== "/profile-setup" && (
        <Navigate to="/profile-setup" />
      )}

      <main id="main-content" tabIndex="-1" style={{ outline: 'none' }}>
        <React.Suspense fallback={<Loader fullPage={true} message="Loading Page..." />}>
          <Routes>
            <Route path="/" element={<ErrorBoundary><Home user={user} /></ErrorBoundary>} />
            <Route path="/advisor" element={<ErrorBoundary><Advisor userData={userData} /></ErrorBoundary>} />
            <Route path="/how-it-works" element={<How />} />
            <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="/crop-guide" element={<CropGuide />} />
            <Route path="/schemes" element={<Schemes />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/login" element={<Auth />} />
            <Route path="/profile-setup" element={<ProfileSetup user={user} profileCompleted={profileCompleted} />} />
            <Route path="/calendar" element={<ErrorBoundary><Calendar /></ErrorBoundary>} />
            <Route path="/share-feedback" element={<Feedback />} />
            <Route path="/admin/feedback" element={<AdminFeedback />} />
            <Route path="/market-prices" element={<ErrorBoundary><MarketPrices /></ErrorBoundary>} />
            <Route path="/farming-map" element={<ErrorBoundary><FarmingMap /></ErrorBoundary>} />
            <Route path="/profit-calculator" element={<ErrorBoundary><CropProfitCalculator /></ErrorBoundary>} />
            <Route path="/community" element={<Community />} />
            <Route path="/soil-analysis" element={<ErrorBoundary><SoilAnalysis /></ErrorBoundary>} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/contributors" element={<Contributors />} />
            <Route path="/trace/:id" element={<QRTraceability />} />
            <Route path="/contact" element={<ContactUs />} />
            <Route path="/about" element={<AboutUs />} />
            <Route path="/crop-planner" element={<ErrorBoundary><SeasonalCropPlanner /></ErrorBoundary>} />
            <Route path="/soil-guide" element={<SoilGuide />} />
            <Route path="/disease-awareness" element={<ErrorBoundary><CropDiseaseAwareness /></ErrorBoundary>} />
            <Route path="/helpline" element={<Helpline />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="/risk-index" element={<ErrorBoundary><RiskIndex /></ErrorBoundary>} />
            <Route path="/crop-rotation" element={<ErrorBoundary><CropRotation /></ErrorBoundary>} />
            <Route path="/seed-verifier" element={<ErrorBoundary><SeedVerifier /></ErrorBoundary>} />
            <Route path="/farm-finance" element={<ErrorBoundary><FarmFinance /></ErrorBoundary>} />
            <Route path="/yield-predictor" element={<ErrorBoundary><YieldPredictor /></ErrorBoundary>} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:id" element={<BlogDetail />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </React.Suspense>
      </main>

      {/* Floating Buttons */}
      <Link to="/advisor" className="floating-chat-btn" aria-label="Open AI Advisor Chat">
        <FaComments size={28} aria-hidden="true" />
      </Link>

      <a
        href="https://wa.me/14155238886?text=I%20want%20to%20start%20the%20conversation"
        target="_blank"
        rel="noopener noreferrer"
        className="whatsapp-float"
        title="Chat with WhatsApp Bot"
      >
        <FaWhatsapp />
        <span className="tooltip">Chat with Bot</span>
      </a>

      {showScrollTop && (
        <button className="scroll-to-top" onClick={scrollToTop} aria-label="Scroll to top">
          <FaChevronUp size={24} />
        </button>
      )}

      <ToastContainer position="bottom-right" />
      <Footer />
    </div>
  );
}

export default App;
