export const ESC = {
    Initialize: [0x1B, 0x40],
    AlignLeft: [0x1B, 0x61, 0x00],
    AlignCenter: [0x1B, 0x61, 0x01],
    AlignRight: [0x1B, 0x61, 0x02],
    BoldOn: [0x1B, 0x45, 0x01],
    BoldOff: [0x1B, 0x45, 0x00],
    TextNormal: [0x1B, 0x21, 0x00],
    TextDoubleHeight: [0x1B, 0x21, 0x10],
    TextDoubleWidth: [0x1B, 0x21, 0x20],
    TextQuad: [0x1B, 0x21, 0x30],
    Cut: [0x1D, 0x56, 0x41, 0x01], // Full cut
    Feed: [0x0A],
};

export class EscPosEncoder {
    constructor() {
        this.buffer = [];
    }

    initialize() {
        this.buffer.push(...ESC.Initialize);
        return this;
    }

    align(align) {
        if (align === 'center') this.buffer.push(...ESC.AlignCenter);
        else if (align === 'right') this.buffer.push(...ESC.AlignRight);
        else this.buffer.push(...ESC.AlignLeft);
        return this;
    }

    bold(active) {
        this.buffer.push(...(active ? ESC.BoldOn : ESC.BoldOff));
        return this;
    }

    size(size) {
        if (size === 'normal') this.buffer.push(...ESC.TextNormal);
        else if (size === 'large') this.buffer.push(...ESC.TextDoubleHeight); // Simple large
        return this;
    }

    text(content) {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        this.buffer.push(...data);
        return this;
    }

    newline(count = 1) {
        for (let i = 0; i < count; i++) {
            this.buffer.push(...ESC.Feed);
        }
        return this;
    }

    line(content) {
        this.text(content).newline();
        return this;
    }

    cut() {
        this.buffer.push(...ESC.Cut);
        return this;
    }

    encode() {
        return new Uint8Array(this.buffer);
    }
}
