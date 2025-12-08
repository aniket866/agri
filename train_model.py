import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error
import joblib
import numpy as np

# Load your dataset
df = pd.read_csv("dataset 5.csv")

# Features (all except the target year) and target (the latest year column)
X = df.drop(columns=["2023-24"])
y = df["2023-24"]

# One-hot encode crop column
X = pd.get_dummies(X, columns=['Crop-wise'], drop_first=True)

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# Train model
model = xgb.XGBRegressor(n_estimators=200, max_depth=6, random_state=42)
model.fit(X_train, y_train)

# Evaluate
preds = model.predict(X_test)
rmse = np.sqrt(mean_squared_error(y_test, preds))
print("✅ Model trained successfully")
print("📊 RMSE:", rmse)

# Save model
joblib.dump(model, "yield_model.joblib")
