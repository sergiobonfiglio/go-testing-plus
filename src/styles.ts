// Simple ANSI color styles for VS Code output

export const styles = {
    green: {
        open: '\u001B[32m',
        close: '\u001B[39m'
    },
    red: {
        open: '\u001B[31m',
        close: '\u001B[39m'
    },
    orange: {
        open: '\u001B[38;5;208m', // 256-color orange
        close: '\u001B[39m'
    },
    yellow: {
        open: '\u001B[33m',
        close: '\u001B[39m'
    },
    gray: {
        open: '\u001B[90m',
        close: '\u001B[39m'
    }
};
