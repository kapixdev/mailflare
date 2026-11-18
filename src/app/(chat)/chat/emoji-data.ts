/** A compact built-in emoji set, grouped like most pickers. Emojis render with the system font, so nothing is downloaded. */
export type EmojiCategoryKey = "smileys" | "people" | "nature" | "food" | "activity" | "objects" | "symbols";

export const EMOJI_CATEGORIES: { key: EmojiCategoryKey; icon: string; emojis: string[] }[] = [
	{ key: "smileys", icon: "😀", emojis: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖".split(" ") },
	{ key: "people", icon: "👍", emojis: "👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🧠 👀 👁️ 👅 👄 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙋 🙇 🤦 🤷 💁 🙆 🙅 🧑‍💻 🧑‍💼 🧑‍🔧 🧑‍🍳 🧑‍🎓 🧑‍🏫 🕺 💃 🏃 🚶".split(" ") },
	{ key: "nature", icon: "🐶", emojis: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🐬 🐳 🦈 🌵 🎄 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🍂 🌷 🌹 🌺 🌸 🌼 🌻 🌞 🌝 🌚 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ 🌊".split(" ") },
	{ key: "food", icon: "🍕", emojis: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌽 🌶️ 🥕 🥔 🥐 🍞 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍣 🍱 🍤 🍙 🍚 🍰 🎂 🧁 🍩 🍪 🍫 🍬 🍭 🍿 ☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷 🍸 🍹".split(" ") },
	{ key: "activity", icon: "⚽", emojis: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ 🏆 🥇 🥈 🥉 🏅 🎖️ 🎗️ 🎫 🎟️ 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🎲 🎯 🎳 🎮 🧩 ✈️ 🚀 🚗 🚕 🚌 🚲 🛵 🚢 🏠 🏢 🏖️ ⛰️ 🗽 🗼".split(" ") },
	{ key: "objects", icon: "💡", emojis: "💡 🔦 🕯️ 💻 🖥️ ⌨️ 🖱️ 📱 ☎️ 📷 📹 📺 ⏰ ⌛ ⏳ 📡 🔋 🔌 💰 💵 💳 💎 🔧 🔨 ⚙️ 🧰 🔑 🔒 🔓 📦 📫 📬 ✉️ 📧 📨 📝 📄 📃 📑 📊 📈 📉 📅 📆 📌 📍 📎 🖇️ ✂️ 🗂️ 📁 📂 🗑️ 🔍 🔔 🔕 📣 📢 🎁 🎈 🎉 🎊".split(" ") },
	{ key: "symbols", icon: "❤️", emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❗ ❓ ‼️ ⁉️ ⚠️ 🚫 ⛔ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔶 🔷 ⬆️ ⬇️ ➡️ ⬅️ 🔄 🆗 🆕 🆒 🆘 💤 💬 💭 🗯️ ♻️ ⭕ 🏁 🚩".split(" ") },
];

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"];

const RECENT_KEY = "mailflare:chat-recent-emoji";
const RECENT_LIMIT = 24;

/** Recently used emojis are a per-browser convenience; storage can be unavailable, so failures are ignored. */
export function readRecentEmojis(): string[] {
	try {
		const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, RECENT_LIMIT) : [];
	} catch {
		return [];
	}
}

export function rememberEmoji(emoji: string) {
	try {
		const next = [emoji, ...readRecentEmojis().filter((item) => item !== emoji)].slice(0, RECENT_LIMIT);
		window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
	} catch {
		// Private windows and blocked storage just skip the recents row.
	}
}
