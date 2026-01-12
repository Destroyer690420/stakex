---
description: StakeX Color Scheme Reference - Use this for all pages and components
---

# StakeX Official Color Scheme

**IMPORTANT: This color scheme MUST be used for all pages and components.**

---

## Primary Colors

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Primary Gold** | `#d4af37` | Accents, buttons, highlights, borders |
| **Gold Hover** | `#f0d78c` | Hover states, light gold accents |
| **Gold Dark** | `#8b7355` | Button gradients, secondary gold |
| **Gold Glow** | `rgba(212, 175, 55, 0.3)` | Box shadows, glows |

---

## Background Colors

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Background Dark** | `#0a0a0a` | Darkest background |
| **Background Medium** | `#0f0f0f` | Main background |
| **Background Navy** | `#1a1a2e` | Gradient middle |
| **Card Background** | `#1a1a1a` | Card surfaces |
| **Card Dark** | `rgba(10, 10, 10, 0.98)` | Card gradients |

### Main Background Gradient
```css
background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0f0f0f 100%);
```

---

## Text Colors

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Primary Text** | `#ffffff` | Main text |
| **Secondary Text** | `#7a8599` | Muted text, labels |
| **Placeholder Text** | `#555555` | Input placeholders |
| **Gold Text** | `#d4af37` | Highlighted text, values |

---

## Status Colors

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Success/Win** | `#00ff88` | Win states, positive |
| **Error/Loss** | `#ff4757` | Errors, losses |
| **Red (Roulette)** | `#c41e3a` | Red numbers |
| **Green (Roulette)** | `#006400` | Zero, green bets |

---

## Border Colors

| Color Name | Hex Code/RGBA | Usage |
|------------|---------------|-------|
| **Gold Border** | `rgba(212, 175, 55, 0.3)` | Active borders |
| **Subtle Border** | `rgba(255, 255, 255, 0.1)` | Card borders |
| **Faint Border** | `rgba(255, 255, 255, 0.05)` | Dividers |

---

## Common Patterns

### Gold Button
```css
background: linear-gradient(135deg, #d4af37 0%, #8b7355 100%);
color: #000;
box-shadow: 0 4px 20px rgba(212, 175, 55, 0.3);
```

### Card Panel
```css
background: linear-gradient(145deg, rgba(26, 26, 26, 0.95) 0%, rgba(10, 10, 10, 0.98) 100%);
border: 1px solid rgba(212, 175, 55, 0.15);
border-radius: 20px;
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
```

### Input Field
```css
background: rgba(0, 0, 0, 0.4);
border: 2px solid rgba(212, 175, 55, 0.15);
color: #fff;
```

### Input Field Focus
```css
border-color: #d4af37;
box-shadow: 0 0 20px rgba(212, 175, 55, 0.15);
```

### Gold Gradient Text
```css
background: linear-gradient(135deg, #d4af37, #f0d78c, #d4af37);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
```

---

## Shadows

| Type | Value |
|------|-------|
| **Card Shadow** | `0 8px 32px rgba(0, 0, 0, 0.4)` |
| **Button Shadow** | `0 4px 20px rgba(212, 175, 55, 0.3)` |
| **Gold Glow** | `0 0 30px rgba(212, 175, 55, 0.3)` |
