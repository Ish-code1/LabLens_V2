import urllib.request
import json
import os
import sqlite3

def generate_ultimate_periodic_table():
    url = "https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json"
    
    # Explicit color mapping for the distinct rule-breakers and allotropes
    color_map = {
        5: "Black/Brown", 6: "Black (Graphite) / Colorless (Diamond)", 
        9: "Pale yellow", 15: "White/Red/Black", 16: "Yellow", 
        17: "Pale green", 29: "Red-orange (Metallic)", 35: "Red-brown", 
        53: "Dark purple/Black", 76: "Bluish-white", 79: "Gold/Yellow", 
        83: "Silvery-pink"
    }
    
    print("Downloading dataset and applying chemical reality checks...")

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            raw_data = json.loads(response.read().decode())

        lablens_elements = []
        highest_atomic_num = 0

        # Process the fetched elements (usually 1 to 118)
        for el in raw_data['elements']:
            atomic_num = el.get('number')
            highest_atomic_num = max(highest_atomic_num, atomic_num)
            phase = el.get('phase', 'Solid')
            
            # 1. Superheavy/Synthetic Elements (Millisecond lifespans)
            if atomic_num > 103:
                exact_color = "Unknown (Synthetic)"
            # 2. Distinct explicitly mapped colors
            elif atomic_num in color_map:
                exact_color = color_map[atomic_num]
            # 3. Gases are colorless (Noble gases and basic diatomics)
            elif phase == "Gas":
                exact_color = "Colorless"
            # 4. Everything else is a standard metal/metalloid
            else:
                exact_color = "Silvery-white" 
                
            raw_block = el.get('block', '')
            clean_block = raw_block.replace("-block", "") if raw_block else ""
            
            period = el.get('period', 1)
            group_num = el.get('group', 1)
            
            # f-block visual adjustment (Lanthanides and Actinides)
            if atomic_num >= 57 and atomic_num <= 71:
                period = 8
                group_num = 4 + (atomic_num - 57)
            elif atomic_num >= 89 and atomic_num <= 103:
                period = 9
                group_num = 4 + (atomic_num - 89)

            lablens_elements.append({
                "atomic_number": atomic_num,
                "symbol": el.get('symbol'),
                "name": el.get('name'),
                "state": phase,
                "color": exact_color,
                "configuration": el.get('electron_configuration', ''),
                "block": clean_block,
                "period": period,
                "group_num": group_num
            })

        # Explicitly inject Element 119 if the API didn't provide it
        if highest_atomic_num < 119:
            lablens_elements.append({
                "atomic_number": 119,
                "symbol": "Uue",
                "name": "Ununennium",
                "state": "Solid", # Predicted phase
                "color": "Unknown (Undiscovered)",
                "configuration": "[Og] 8s1",
                "block": "s",
                "period": 8,
                "group_num": 1
            })

        # Save to the local directory
        output_path = os.path.abspath(os.path.join(os.path.dirname(__file__), 'lablens_elements.json'))
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(lablens_elements, f, indent=4)
            
        print(f"Success! {len(lablens_elements)} elements (including 119) saved to:\n{output_path}")

        # Seed Database
        db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), 'lablens.db'))
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("DROP TABLE IF EXISTS elements")
        cursor.execute('''
        CREATE TABLE elements (
            atomic_number INTEGER PRIMARY KEY,
            symbol TEXT NOT NULL,
            name TEXT NOT NULL,
            state TEXT NOT NULL,
            color TEXT NOT NULL,
            block TEXT NOT NULL,
            period INTEGER NOT NULL,
            group_num INTEGER NOT NULL,
            electronic_config TEXT NOT NULL
        )
        ''')
        
        for e in lablens_elements:
            cursor.execute('''
            INSERT INTO elements (atomic_number, symbol, name, state, color, block, period, group_num, electronic_config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (e['atomic_number'], e['symbol'], e['name'], e['state'], e['color'], e['block'], e['period'], e['group_num'], e['configuration']))
            
        conn.commit()
        conn.close()
        
        print(f"Success! {len(lablens_elements)} elements inserted into lablens.db")

    except Exception as e:
        print(f"Extraction failed: {e}")

if __name__ == "__main__":
    generate_ultimate_periodic_table()