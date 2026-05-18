import sys
import re

with open('GATES.md', 'r') as f:
    content = f.read()

# Extraire les gates bloqués
blocked = re.findall(r'\| (G\d.*?) \| ❌', content)
if blocked:
    print(f"GATES BLOQUÉS : {', '.join(blocked)}")
    sys.exit(1)

print("Tous les gates sont OK ou en attente normale.")
sys.exit(0)
