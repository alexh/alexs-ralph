#!/usr/bin/env bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PINK='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ALEX_DIR="$HOME/.alex"
ALEX_CONFIG="$ALEX_DIR/config.yaml"
WORKTREE_DIR="$ALEX_DIR/worktrees"
WT_CONFIG="$HOME/.config/worktrunk/config.toml"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo -e "${PINK}"
cat "$SCRIPT_DIR/src/animations/alex.txt"
echo -e "${NC}"
echo -e "${CYAN}Another Loop Experience - Setup Wizard${NC}"
echo ""

# Check if already installed
if [ -d "$ALEX_DIR" ] && [ -f "$ALEX_CONFIG" ]; then
    echo -e "${YELLOW}Looks like ALEx has already infected this system...${NC}"
    echo -e "  Config: ${CYAN}$ALEX_CONFIG${NC}"
    echo ""
    echo -e "Run ${CYAN}alex${NC} to start, or run ${CYAN}alex uninstall${NC} before installing again."
    exit 0
fi

# Check dependencies
check_dep() {
    if command -v "$1" &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} $1 found"
        return 0
    else
        echo -e "  ${RED}✗${NC} $1 not found"
        return 1
    fi
}

echo -e "${YELLOW}Checking dependencies...${NC}"
MISSING_DEPS=0
check_dep "bun" || MISSING_DEPS=1
check_dep "git" || MISSING_DEPS=1
check_dep "gh" || MISSING_DEPS=1

# wt is optional but recommended
if ! check_dep "wt"; then
    echo -e "    ${YELLOW}(optional - enables worktree isolation per loop)${NC}"
fi

if [ $MISSING_DEPS -eq 1 ]; then
    echo ""
    echo -e "${RED}Missing required dependencies. Please install them first:${NC}"
    echo "  - bun: https://bun.sh"
    echo "  - git: https://git-scm.com"
    echo "  - gh: https://cli.github.com"
    echo "  - wt (optional): https://worktrunk.dev"
    exit 1
fi

echo ""

# Create ~/.alex directory
echo -e "${YELLOW}Setting up ~/.alex directory...${NC}"
mkdir -p "$ALEX_DIR"
mkdir -p "$WORKTREE_DIR"
mkdir -p "$ALEX_DIR/adapters"
echo -e "  ${GREEN}✓${NC} Created $ALEX_DIR"
echo -e "  ${GREEN}✓${NC} Created $WORKTREE_DIR"

# Configure worktrunk if available
if command -v wt &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Configuring worktrunk...${NC}"

    # Detect repo depth to calculate relative path
    # Default assumes repos are in ~/dev/ or ~/code/ (2 levels from home)
    REPO_DEPTH=2

    echo -e "  Alex uses git worktrees to isolate each loop's changes."
    echo -e "  Worktrees will be created in: ${CYAN}$WORKTREE_DIR${NC}"
    echo ""

    # Calculate relative path (worktrunk requires relative paths)
    # For repos at ~/dev/myrepo, we need ../../.alex/worktrees/
    RELATIVE_PATH=""
    for ((i=0; i<REPO_DEPTH; i++)); do
        RELATIVE_PATH="../$RELATIVE_PATH"
    done
    RELATIVE_PATH="${RELATIVE_PATH}.alex/worktrees/{{ repo }}/{{ branch | sanitize }}"

    # Check if worktrunk config exists
    if [ -f "$WT_CONFIG" ]; then
        if grep -q "worktree-path" "$WT_CONFIG"; then
            echo -e "  ${YELLOW}!${NC} worktrunk config already has worktree-path set"
            echo -e "    Current config: $WT_CONFIG"
            echo ""
            read -p "  Overwrite worktree-path setting? [y/N] " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # Remove existing worktree-path line and add new one
                sed -i.bak '/^worktree-path/d' "$WT_CONFIG"
                # Add at the beginning
                echo -e "worktree-path = \"$RELATIVE_PATH\"\n$(cat "$WT_CONFIG")" > "$WT_CONFIG"
                echo -e "  ${GREEN}✓${NC} Updated worktrunk config"
            else
                echo -e "  ${YELLOW}→${NC} Skipped worktrunk config update"
            fi
        else
            # Add worktree-path to existing config
            echo -e "worktree-path = \"$RELATIVE_PATH\"\n$(cat "$WT_CONFIG")" > "$WT_CONFIG"
            echo -e "  ${GREEN}✓${NC} Added worktree-path to worktrunk config"
        fi
    else
        # Create new worktrunk config
        mkdir -p "$(dirname "$WT_CONFIG")"
        cat > "$WT_CONFIG" << EOF
# Worktrunk config - configured by Another Loop Experience installer
# Worktrees are created in ~/.alex/worktrees/ for loop isolation
worktree-path = "$RELATIVE_PATH"
EOF
        echo -e "  ${GREEN}✓${NC} Created worktrunk config at $WT_CONFIG"
    fi

    echo ""
    echo -e "  ${CYAN}Note:${NC} The relative path assumes repos are ${REPO_DEPTH} levels deep from \$HOME"
    echo -e "        (e.g., ~/dev/myrepo or ~/code/project)"
    echo -e "        Edit $WT_CONFIG if your repos are elsewhere."
fi

# Create default alex config
echo ""
echo -e "${YELLOW}Creating ALEx config...${NC}"

if [ -f "$ALEX_CONFIG" ]; then
    echo -e "  ${YELLOW}!${NC} Config already exists at $ALEX_CONFIG"
    read -p "  Overwrite? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "  ${YELLOW}→${NC} Skipped config creation"
        SKIP_CONFIG=1
    fi
fi

if [ -z "$SKIP_CONFIG" ]; then
    cat > "$ALEX_CONFIG" << 'EOF'
# Another Loop Experience Configuration
# See https://github.com/alexh/alexs-ralph for documentation

# Worktree settings
worktrees:
  # Enable worktree isolation per loop (requires wt CLI)
  enabled: true
  # Base directory for worktrees (used by worktrunk via relative path)
  # Note: worktrunk config (~/.config/worktrunk/config.toml) must also be set
  baseDir: ~/.alex/worktrees

# Loop defaults
loops:
  # Default max iterations before stopping
  maxIterations: 20
  # Iteration timeout in milliseconds (10 minutes)
  iterationTimeoutMs: 600000
  # Auto-complete loops when all criteria are met
  autoCompleteOnCriteria: true

# Stuck loop detection
stuckDetection:
  # Enable stuck loop warnings
  enabled: true
  # Threshold in minutes before showing warning
  thresholdMinutes: 5

# UI settings
ui:
  # Show hidden loops by default
  showHidden: false
  # Log tail lines to show
  logTailLines: 100
EOF
    echo -e "  ${GREEN}✓${NC} Created config at $ALEX_CONFIG"
fi

# Install dependencies
echo ""
echo -e "${YELLOW}Installing dependencies...${NC}"
cd "$(dirname "$0")"
bun install
echo -e "  ${GREEN}✓${NC} Dependencies installed"

# Build
echo ""
echo -e "${YELLOW}Building...${NC}"
bun run build
echo -e "  ${GREEN}✓${NC} Build complete"

# Link globally
echo ""
echo -e "${YELLOW}Linking globally...${NC}"
bun link
echo -e "  ${GREEN}✓${NC} Linked globally"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo -e "Run Alex with:"
echo -e "  ${CYAN}alex${NC}"
echo ""
echo -e "Configuration files:"
echo -e "  Alex config:      ${CYAN}$ALEX_CONFIG${NC}"
if command -v wt &> /dev/null; then
echo -e "  Worktrunk config: ${CYAN}$WT_CONFIG${NC}"
fi
echo -e "  Worktrees dir:    ${CYAN}$WORKTREE_DIR${NC}"
echo ""
