from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sqlite3
import os

app = FastAPI()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.path.join(BASE_DIR, "lablens.db")

# Ensure the database exists or create it
if not os.path.exists(DB_NAME):
    import data
    data.init_db()

def get_db():
    # Vercel serverless environment is strictly read-only.
    # We must connect via URI in read-only mode to prevent write-lock crashes.
    conn = sqlite3.connect(f"file:{DB_NAME}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/api/chemicals")
def get_chemicals():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM elements")
    elements = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    # Group by block
    blocks = {'s_block': [], 'p_block': [], 'd_block': [], 'general': []}
    for e in elements:
        blk = e['block'] + '_block' if e['block'] in ['s', 'p', 'd'] else 'general'
        if blk in blocks:
            blocks[blk].append(e['symbol'])
        else:
            blocks['general'].append(e['symbol'])
            
    # Remove empty blocks
    blocks = {k: v for k, v in blocks.items() if v}
    
    # Add compounds for the reactions to general block
    compounds = ['NaHCO3', 'CaO', 'NH4Cl', 'H2SO4(dil)', 'H2SO4(conc)', 'HNO3(conc)', 'O2', 'NaOH(conc)', 'AgNO3', 'NaCl', 'Pb(NO3)2', 'KI', 'BaCl2', 'Na2SO4', 'FeCl3', 'NaOH', 'CuSO4', 'NH4OH(excess)', 'K4[Fe(CN)6]', 'KMnO4', 'FeSO4(acidic)', 'K2Cr2O7', 'Na2CO3', 'H2O']
    compounds = list(dict.fromkeys(compounds)) # remove duplicates
    
    # filter out anything that is already in blocks
    all_els = set(sum(blocks.values(), []))
    compounds = [c for c in compounds if c not in all_els]
    
    if 'general' not in blocks:
        blocks['general'] = []
        
    blocks['general'].extend(compounds)
    
    return {"blocks": blocks, "elements": elements}

class ReactRequest(BaseModel):
    chem1: str
    chem2: str

@app.post("/api/react")
def react(req: ReactRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, reactant_1, reactant_2, conditions, products, equation, observation, block, animation_type, exam_tag
        FROM reactions 
        WHERE (reactant_1=? AND reactant_2=?) OR (reactant_1=? AND reactant_2=?)
    ''', (req.chem1, req.chem2, req.chem2, req.chem1))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {"reaction": dict(row)}
    return {"reaction": None}

@app.get("/api/reactions")
def get_reactions():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, reactant_1, reactant_2, observation, block, exam_tag FROM reactions")
    reactions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"reactions": reactions}


app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5000)
