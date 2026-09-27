import SwiftUI
import UIKit

/// StepSafe light and dark palette and the locked hazard glyphs.
///
/// Dark and light colors match `web/app/globals.css`. The app follows the system appearance.
/// Glyphs are byte copies of `web/public/hazard-icons/*.png`
/// (manifest `sourceSha256` `56b966cf16c6e4264b09bdd0cc7de0d19ac4c77aab87a6d32e6476f724e615fb`).
/// The app scales those pixels for display. It does not redraw or recolor them.
enum Palette {
    struct CategoryChrome {
        var letter: String
        var color: Color
        var ink: Color
    }

    /// Pin category colors from `web/lib/api.ts` `CATEGORY_META`. Temporary uses `--hazard`.
    static func category(_ raw: String) -> CategoryChrome {
        switch raw {
        case "moving":
            return CategoryChrome(letter: "M", color: .moving, ink: .markRing)
        case "permanent":
            return CategoryChrome(letter: "P", color: .permanent, ink: .white)
        default:
            return CategoryChrome(letter: "T", color: .temporary, ink: .markRing)
        }
    }

    /// Page and tab chrome. Dynamic colors follow light and dark.
    static func applyChrome() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = PaletteTokens.page
        nav.shadowColor = PaletteTokens.line
        nav.titleTextAttributes = [.foregroundColor: PaletteTokens.ink]
        nav.largeTitleTextAttributes = [.foregroundColor: PaletteTokens.ink]
        let bar = UINavigationBar.appearance()
        bar.standardAppearance = nav
        bar.scrollEdgeAppearance = nav
        bar.compactAppearance = nav
        bar.tintColor = PaletteTokens.blue

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = PaletteTokens.page
        let ink = PaletteTokens.ink3
        let blue = PaletteTokens.blue
        // Selected titles are text on the page. Light uses the link ink; the icon stays brand blue.
        let title = PaletteTokens.controlInk
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            item.normal.iconColor = ink
            item.normal.titleTextAttributes = [.foregroundColor: ink]
            item.selected.iconColor = blue
            item.selected.titleTextAttributes = [.foregroundColor: title]
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

/// UIKit colors that resolve for the current appearance. SwiftUI `Color` wraps these.
enum PaletteTokens {
    static func hex(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: alpha)
    }

    static func pair(dark: UIColor, light: UIColor) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? dark : light }
    }

    static let page = pair(dark: hex(0x081624), light: hex(0xF4F4F5))
    static let card = pair(dark: hex(0x0F1C2A), light: hex(0xFFFFFF))
    static let raised = pair(dark: hex(0x152536), light: hex(0xF3F5F8))
    static let sunken = pair(dark: hex(0x0C1824), light: hex(0xEEF0F3))
    static let hover = pair(dark: hex(0x1A2C40), light: hex(0xE7EAEE))
    static let sheetTop = pair(dark: hex(0x16283B), light: hex(0xFFFFFF))
    static let ink = pair(dark: hex(0xF5F5F5), light: hex(0x0A0A0A))
    static let ink2 = pair(dark: hex(0xC5C8CC), light: hex(0x3E4651))
    static let ink3 = pair(dark: hex(0xA1A5AB), light: hex(0x3E4651))
    static let blue = hex(0x087FF5)
    static let signal = pair(dark: hex(0x13B9F2), light: hex(0x087FF5))
    /// Status words. Dark matches `--signal`. Light matches web link `--accent` `#0757B0`
    /// (6.37:1 on `#F4F4F5`, 7.00:1 on `#FFFFFF`). `#087FF5` stays the fill.
    static let signalText = pair(dark: hex(0x13B9F2), light: hex(0x0757B0))
    /// Links and selected tab titles. Dark stays `#087FF5` (4.66:1 on the page). Light is the same link ink.
    static let controlInk = pair(dark: hex(0x087FF5), light: hex(0x0757B0))
    static let accentTint = pair(dark: hex(0x13B9F2, alpha: 0.16), light: hex(0x087FF5, alpha: 0.12))
    static let signalSoft = pair(dark: hex(0x13B9F2, alpha: 0.28), light: hex(0x087FF5, alpha: 0.22))
    /// Web `primary` / `primary-ink`. Dark pills are light; light pills are navy.
    static let primary = pair(dark: hex(0xF5F5F5), light: hex(0x081624))
    static let primaryInk = pair(dark: hex(0x081624), light: hex(0xF5F5F5))
    static let hazard = hex(0xFF7900)
    static let warnInk = pair(dark: hex(0xFFB473), light: hex(0x8A4200))
    static let warnTint = pair(dark: hex(0x2A1A0C), light: hex(0xFFF4EA))
    static let line = pair(dark: UIColor.white.withAlphaComponent(0.08), light: hex(0x081624, alpha: 0.10))
    static let borderStrong = pair(dark: UIColor.white.withAlphaComponent(0.22), light: hex(0x081624, alpha: 0.22))
    static let field = pair(dark: UIColor.white.withAlphaComponent(0.22), light: hex(0x081624, alpha: 0.28))
    static let moving = hex(0xFFC23D)
    static let permanent = hex(0xD93A1E)
    /// Category-mark ring. The web pin hardcodes navy so the badge stays visible on a light card.
    static let markRing = hex(0x081624)
}

extension Color {
    /// sRGB hex, matching the CSS tokens.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    // Names follow the CSS variables. Each one resolves for light and dark.
    static let page = Color(uiColor: PaletteTokens.page)
    static let card = Color(uiColor: PaletteTokens.card)
    static let raised = Color(uiColor: PaletteTokens.raised)
    static let sunken = Color(uiColor: PaletteTokens.sunken)
    static let hover = Color(uiColor: PaletteTokens.hover)
    static let sheetTop = Color(uiColor: PaletteTokens.sheetTop)
    static let ink = Color(uiColor: PaletteTokens.ink)
    static let ink2 = Color(uiColor: PaletteTokens.ink2)
    static let ink3 = Color(uiColor: PaletteTokens.ink3)
    static let control = Color(uiColor: PaletteTokens.blue)
    static let controlInk = Color(uiColor: PaletteTokens.controlInk)
    static let signal = Color(uiColor: PaletteTokens.signal)
    static let signalText = Color(uiColor: PaletteTokens.signalText)
    static let accentTint = Color(uiColor: PaletteTokens.accentTint)
    static let signalSoft = Color(uiColor: PaletteTokens.signalSoft)
    static let primaryFill = Color(uiColor: PaletteTokens.primary)
    static let primaryInk = Color(uiColor: PaletteTokens.primaryInk)
    static let hazard = Color(uiColor: PaletteTokens.hazard)
    static let warnInk = Color(uiColor: PaletteTokens.warnInk)
    static let warnTint = Color(uiColor: PaletteTokens.warnTint)
    static let line = Color(uiColor: PaletteTokens.line)
    static let borderStrong = Color(uiColor: PaletteTokens.borderStrong)
    static let field = Color(uiColor: PaletteTokens.field)
    /// Label on a `--blue` fill. White is 3.91:1; `--ink` on the same blue is 3.59:1.
    static let onBlue = Color.white
    /// Category-letter ink. Stays navy on yellow and orange in both appearances.
    static let markRing = Color(uiColor: PaletteTokens.markRing)

    // Category fills. Temporary is the hazard orange; moving and permanent are not.
    static let moving = Color(uiColor: PaletteTokens.moving)
    static let temporary = hazard
    static let permanent = Color(uiColor: PaletteTokens.permanent)

    // Older view names. Page is navy; secondary text is ink3 (7.38:1 on navy, was #66717E at 3.67:1).
    static let navy = page
    static let slate = ink3
}

extension View {
    /// `--card` with the `--line` hairline used on web panels.
    func cardSurface(radius: CGFloat = 12) -> some View {
        background(Color.card, in: RoundedRectangle(cornerRadius: radius))
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .stroke(Color.line, lineWidth: 1)
                    .allowsHitTesting(false)
            )
    }
}

/// Loads a locked-sheet crop from `HazardIcons/<id>.png`. Missing files draw nothing.
enum LockedHazardIcons {
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 80
        return cache
    }()

    static func image(named id: String) -> UIImage? {
        let key = id as NSString
        if let hit = cache.object(forKey: key) { return hit }
        guard let url = Bundle.main.url(forResource: id, withExtension: "png", subdirectory: "HazardIcons"),
              let image = UIImage(contentsOfFile: url.path) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }
}

/// One locked glyph, original pixels, scaled to fit `side`.
struct LockedHazardIcon: View {
    var name: String
    var side: CGFloat = 28

    var body: some View {
        if let image = LockedHazardIcons.image(named: name) {
            Image(uiImage: image)
                .renderingMode(.original)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: side, height: side)
                .accessibilityHidden(true)
        }
    }
}

/// Locked glyph, category edge, and the M/T/P mark. Same chrome as the web pin.
struct HazardPin: View {
    var type: String
    var category: String
    var side: CGFloat = 28

    private var chrome: Palette.CategoryChrome { Palette.category(category) }

    var body: some View {
        Group {
            if LockedHazardIcons.image(named: type) != nil {
                LockedHazardIcon(name: type, side: side)
                    .overlay(
                        RoundedRectangle(cornerRadius: side * 0.22)
                            .stroke(chrome.color, lineWidth: 2)
                    )
                    .overlay(alignment: .bottomTrailing) { mark.offset(x: 5, y: 5) }
                    .padding(.trailing, 6)
                    .padding(.bottom, 6)
            } else {
                ZStack {
                    Circle().fill(chrome.color)
                    Text(chrome.letter)
                        .font(.caption.bold())
                        .foregroundStyle(chrome.ink)
                }
                .frame(width: side, height: side)
            }
        }
        .accessibilityHidden(true)
    }

    /// Category letter. Sits on the glyph's bottom-trailing corner, same place as the web pin.
    private var mark: some View {
        Text(chrome.letter)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(chrome.ink)
            .padding(.horizontal, 2)
            .frame(minWidth: 14, minHeight: 14)
            .background(chrome.color, in: Capsule())
            .overlay(Capsule().stroke(Color(uiColor: PaletteTokens.markRing), lineWidth: 1))
    }
}
