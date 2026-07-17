with open('/root/orgr/src/routes/claude-assist.js', 'r') as f:
    content = f.read()

# When persona_prefix is provided, strip the "You are Dale..." identity intro
# from systemPrompt so only the data sections (policies, stats, CSW etc.) remain.
# The persona_prefix establishes identity; OrgΩr provides the data.

old = "var effectiveSystem = persona_prefix ? persona_prefix + '\\n\\n--- LIVE TASK DATA ---\\n' + systemPrompt : systemPrompt;"

new = (
    "var dataSection = persona_prefix ? (systemPrompt.indexOf('YOUR STANDING POLICIES:') !== -1 ? systemPrompt.slice(systemPrompt.indexOf('YOUR STANDING POLICIES:')) : systemPrompt) : systemPrompt;\n"
    "      var effectiveSystem = persona_prefix ? persona_prefix + '\\n\\n--- LIVE TASK DATA ---\\n' + dataSection : systemPrompt;"
)

print('matched:', old in content)
fixed = content.replace(old, new)

with open('/root/orgr/src/routes/claude-assist.js', 'w') as f:
    f.write(fixed)
print('done')
