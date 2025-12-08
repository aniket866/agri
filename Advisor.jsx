import React, { useEffect, useState } from "react";
import "./Advisor.css";
import WeatherCard from "./WeatherCard";
import SoilChatbot from "./SoilChatbot";
import {
  Sun,
  Droplets,
  IndianRupee,
  Sprout,
  Languages,
  WifiOff,
} from "lucide-react";

export default function Advisor() {
  const [farmers, setFarmers] = useState(0);
  const [crops, setCrops] = useState(0);
  const [languages, setLanguages] = useState(0);

  const [showWeather, setShowWeather] = useState(false);
  const [showSoilChatbot, setShowSoilChatbot] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false); // 🔹 new state

  useEffect(() => {
    let f = 0,
      c = 0,
      l = 0;
    const interval = setInterval(() => {
      if (f < 5000) setFarmers((f += 50));
      if (c < 120) setCrops((c += 2));
      if (l < 10) setLanguages((l += 1));
    }, 50);
    return () => clearInterval(interval);
  }, []);
 const [yieldPrediction, setYieldPrediction] = useState(null);
const [showYieldPopup, setShowYieldPopup] = useState(false);

const fetchYield = async () => {
  try {
    const response = await fetch("http://127.0.0.1:8000/predict");
    const data = await response.json();
    setYieldPrediction(data.predicted_yield);
    setShowYieldPopup(true);
  } catch (error) {
    console.error("Error fetching yield:", error);
  }
};

  return (
    <section className="advisor">
      {/* Floating background icons */}
      <div className="floating-icons">
        <span>🌱</span>
        <span>☀️</span>
        <span>💧</span>
        <span>₹</span>
      </div>
 
      {/* Hero Section */}
      <div className="advisor-hero">
        <h1 className="fade-in">🌱 AI-Powered Agricultural Advisor</h1>
        <p className="fade-in">
          Personalized guidance for <span className="highlight">weather</span>,{" "}
          <span className="highlight">markets</span>, and{" "}
          <span className="highlight">soil health</span>.
        </p>
        <button className="get-started shine" onClick={() => setShowComingSoon(true)}>🚀 Get Started</button>
      </div>

      {/* Stats Section */}
      <div className="advisor-stats">
        <div className="stat">
          <h2>{languages}+</h2>
          <p>Languages Available</p>
        </div>
      </div>

      <br />
      <br />

      {/* Highlights Section */}
      <div className="advisor-highlights">
  <h2 className="slide-in">✨ Features</h2>
  <br/><br/>
  <div className="cards">
    {/* Weather */}
    <div
      className="card reveal"
      style={{ cursor: "pointer" }}
      onClick={() => setShowWeather(true)}
    >
      <div className="icon">
        <Sun size={32} strokeWidth={2} />
      </div>
      <h3>Weather Forecasts</h3>
      <p>Accurate daily & weekly weather insights for farming decisions.</p>
    </div>

    {/* Farmer-to-Farmer Community */}
    <div className="card reveal" onClick={() => setShowComingSoon(true)}>
      <div className="icon">
        👨‍🌾👩‍🌾
      </div>
      <h3>Farmer Community</h3>
      <p>Connect, share tips, and learn from other farmers in your region.</p>
    </div>
    {/* Irrigation */}
    <div className="card reveal" onClick={() => setShowComingSoon(true)}>
      <div className="icon">
        <Droplets size={32} strokeWidth={2} />
      </div>
      <h3>Irrigation Guidance</h3>
      <p>Water-saving tips and irrigation schedules tailored to your crops.</p>
    </div>

    {/* Market */}
    <div className="card reveal" onClick={() => setShowComingSoon(true)}>
      <div className="icon">
        <IndianRupee size={32} strokeWidth={2} />
      </div>
      <h3>Market Price Guidance</h3>
      <p>Market trends and price alerts to help you sell at the best time.</p>
    </div>

    {/* Soil → Opens Chatbot */}
    <div
      className="card reveal"
      style={{ cursor: "pointer" }}
      onClick={() => setShowSoilChatbot(true)}
    >
      <div className="icon">
        <Sprout size={32} strokeWidth={2} />
      </div>
      <h3>Soil Health</h3>
      <p>Get soil analysis & recommendations via AI chatbot.</p>
    </div>

    {/* Crop Disease Detection */}
    <div className="card reveal" onClick={() => setShowComingSoon(true)}>
      <div className="icon">
        🌿
      </div>
      <h3>Crop Disease Detection</h3>
      <p>Upload plant images to detect diseases and get remedies.</p>
    </div>

    {/* Fertilizer Recommendations */}
    <div className="card reveal" onClick={() => setShowComingSoon(true)}>
      <div className="icon">
        🌾
      </div>
      <h3>Fertilizer Recommendations</h3>
      <p>AI-powered fertilizer advice tailored to your soil & crops.</p>
    </div>
    {/* Offline Access */}
    <div className="card reveal" onClick={() => setShowComingSoon(true)}>
      <div className="icon">
        <WifiOff size={32} strokeWidth={2} />
      </div>
      <h3>Offline Access</h3>
      <p>Use the app anytime, even without internet connectivity.</p>
    </div>
    {/* Pest Management */}
    <div className="card reveal" onClick={() => setShowComingSoon(true)}>
      <div className="icon">
        🐛
      </div>
      <h3>Pest Management</h3>
      <p>Early warnings & organic pest control tips.</p>
    </div>
    
    {/* Yield Prediction */}
{/* Yield Prediction */}
<div
  className="card reveal"
  style={{ cursor: "pointer" }}
  onClick={() => fetchYield()}
>
  <div className="icon">📊</div>
  <h3>Yield Prediction</h3>
  <p>AI predicts crop yield based on soil & weather data.</p>
</div>

  </div>
</div>
      {/* Weather popup */}
      {showWeather && (
        <div className="weather-overlay">
          <div className="weather-popup">
            <WeatherCard onClose={() => setShowWeather(false)} />
          </div>
        </div>
      )}

      {/* Soil Chatbot popup */}
      {showSoilChatbot && (
        <div className="weather-overlay">
          <div className="weather-popup">
            <SoilChatbot onClose={() => setShowSoilChatbot(false)} />
          </div>
        </div>
      )}
      {/* Yield Prediction popup */}
{showYieldPopup && (
  <div className="weather-overlay">
    <div className="weather-popup">
      <h2>📊 Yield Prediction</h2>
      <p>Predicted Yield: <strong>{yieldPrediction}</strong></p>
      <button className="close-btn" onClick={() => setShowYieldPopup(false)}>
        Close
      </button>
    </div>
  </div>
)}

      {/* Coming Soon popup */}
      {showComingSoon && (
        <div className="weather-overlay">
          <div className="weather-popup coming-soon">
            <h2>🚧 Coming Soon</h2>
            <p>This feature is under development. Stay tuned!</p>
            <button
              className="close-btn"
              onClick={() => setShowComingSoon(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <br />
      <br />


    </section>
  );
}
