from datasets import load_dataset
import pandas as pd
from dotenv import load_dotenv
import os

load_dotenv()
token = os.getenv("HUGGING_FACE_HUB_TOKEN")
# Charger le dataset (streaming si gros)
dataset = load_dataset("cexplorers/firms-hotspots", token=token)

# Convertir en DataFrame pour analyse
df = pd.DataFrame(dataset)
print(df.head())