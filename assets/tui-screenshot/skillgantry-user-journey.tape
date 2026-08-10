Require node

Output assets/tui-screenshot/skillgantry-user-journey.gif

Set Shell "zsh"
Set FontSize 14
Set FontFamily "Menlo"
Set Width 1440
Set Height 720
Set Framerate 12
Set TypingSpeed 35ms
Set CursorBlink false
Set PlaybackSpeed 1.15

Hide
Type `export HOME="$(node assets/tui-screenshot/prepare-user-journey.mjs)"`
Enter
Sleep 1s
Type "node dist/cli/index.js"
Enter
Show
Sleep 2s

# Select code-review-expert in the Skills browser, then view its SKILL.md.
Type "j"
Sleep 2s
Tab
Type "5"
Sleep 2s

# Mark and run Validate, Evaluate, and Security.
Type "1"
Type " "
Type "l"
Type " "
Type "l"
Type " "
Sleep 1s
Type "r"
Sleep 7s

# Inspect the first run through Log, Findings, Issues, and Artefacts.
Type "1"
Sleep 2s
Type "2"
Sleep 2s
Type "3"
Sleep 2s
Type "4"
Sleep 2s

# Open Optimise and copy the generated SkillHone prompt.
Type "l"
Type " "
Type "r"
Sleep 3s
Type "y"
Sleep 2s
Escape
Sleep 1s

# Run Release with an illustrative minor target and release note.
Type "l"
Type " "
Type "r"
Sleep 2s
Type "minor"
Tab
Type "Demonstrate the reviewed release workflow"
Sleep 2s
Enter
Sleep 7s

# Inspect the release attempt through the same four evidence tabs.
Type "1"
Sleep 2s
Type "2"
Sleep 2s
Type "3"
Sleep 2s
Type "4"
Sleep 2s

# Finish on Dashboard.
Type "0"
Sleep 4s
