// .misc/autounattend.ts
import { readFileSync } from "node:fs";

// lib/utils.ts
import fs from "node:fs";
import path from "node:path";
import proc from "node:child_process";
var rootDir = path.join(path.dirname(import.meta.url.replace("file://", "")), "..");
var escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;").replace(/«/g, "&#xAB;").replace(/»/g, "&#xBB;").replace(/…/g, "&#x2026;").replace(/&amp;#x/g, "&#x");
var indentLines = (templateSource, indent = 0) => {
  const [line1, ...lines] = templateSource.split("\n");
  const rendered = [
    line1,
    ...lines.map((line) => " ".repeat(indent) + line)
  ];
  return rendered.join("\n");
};
var renderXmlTag = (tag, indent, endIndent, rendered, targetPath) => {
  return [
    `<${tag}${targetPath ? ` path="${targetPath}"` : ""}>`,
    escapeXml(indentLines(rendered, indent)),
    " ".repeat(endIndent) + `</${tag}>`
  ].join("\n");
};
var isObject = (value) => Object.prototype.toString.call(value) === "[object Object]";
var makePs1List = (indent) => {
  const indentStr = " ".repeat(indent);
  return (items) => `${indentStr}${items.map((p) => `'${p}'`).join(`;
${indentStr}`)};`;
};
var toDword = ([k, v]) => [
  `'${k}'`,
  v
];
var makeTag = (tag, indent = 0, endIndent = 0) => (rendered, targetPath = null) => renderXmlTag(tag, indent, endIndent, rendered, targetPath);
var stripJsonComments = (jsonc) => jsonc.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
var parseJsonc = (jsonc) => {
  return JSON.parse(stripJsonComments(jsonc));
};

// config/_misc.ts
var PROTECT_YOUR_PC = {
  Recommended: 1,
  OnlyUpdates: 2,
  AutomaticProtectionDisabled: 3
};
var getMiscParams = (params) => ({
  ProtectYourPC: params.ProtectYourPC && PROTECT_YOUR_PC[params.ProtectYourPC],
  PasswordExpiration: params.PasswordExpiration
});

// config/_disk-parts.ts
var echo = (cmd) => "echo:" + cmd;
var cmdsGroup = (cmds) => 'cmd.exe /c ">>"X:\\diskpart.txt" (' + cmds.map(echo).join("&") + ')"';
var getDefaultDiskParams = () => ({
  // Disk settings
  PartitionMode: void 0,
  PartitionLayout: void 0,
  EspSize: void 0,
  BootDrive: "S",
  RecoverySize: void 0,
  WindowsDrive: "W",
  RecoveryDrive: "R"
});
var MBR = (settings) => [
  [
    `SELECT DISK=0`,
    "CLEAN",
    `CREATE PARTITION PRIMARY SIZE=100`,
    `FORMAT QUICK FS=NTFS LABEL="System Reserved"`,
    `ASSIGN LETTER=${settings.BootDrive}`,
    "ACTIVE",
    "CREATE PARTITION PRIMARY",
    `SHRINK MINIMUM=${settings.RecoverySize}`
  ],
  [
    `FORMAT QUICK FS=NTFS LABEL="Windows"`,
    `ASSIGN LETTER=${settings.WindowsDrive}`,
    `CREATE PARTITION PRIMARY`,
    `FORMAT QUICK FS=NTFS LABEL="Recovery"`,
    `ASSIGN LETTER=${settings.RecoveryDrive}`,
    `SET ID=27`
  ]
].map(cmdsGroup);
var GPT = (settings) => [
  [
    `SELECT DISK=0`,
    `CLEAN`,
    `CONVERT GPT`,
    `CREATE PARTITION EFI SIZE=${settings.EspSize}`,
    `FORMAT QUICK FS=FAT32 LABEL=^"System^"`,
    `ASSIGN LETTER=${settings.BootDrive}`,
    `CREATE PARTITION MSR SIZE=16`,
    `CREATE PARTITION PRIMARY`
  ],
  [
    `SHRINK MINIMUM=1007`,
    `FORMAT QUICK FS=NTFS LABEL=^"Windows^"`,
    `ASSIGN LETTER=${settings.WindowsDrive}`,
    `CREATE PARTITION PRIMARY`,
    `FORMAT QUICK FS=NTFS LABEL=^"Recovery^"`,
    `ASSIGN LETTER=${settings.RecoveryDrive}`
  ],
  [
    `SET ID=^"de94bba4-06d1-4d40-a16a-bfd50179d6ac^"`,
    `GPT ATTRIBUTES=0x8000000000000001`
  ]
].map(cmdsGroup);
var getCmds = (cmds) => [
  ...cmds.PartitionLayout === "GPT" ? GPT(cmds) : MBR(cmds),
  'cmd.exe /c "diskpart.exe /s "X:\\diskpart.txt" >>"X:\\diskpart.log" || ( type "X:\\diskpart.log" & echo diskpart encountered an error. & pause & exit /b 1 )"'
];
var getDiskpartCommands = (cmds) => Boolean(cmds.PartitionLayout) ? getCmds(cmds) : [];

// config/_windows-pe.ts
var BYPASS_REQUIREMENTS = [
  'reg.exe add "HKLM\\SYSTEM\\Setup\\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f',
  'reg.exe add "HKLM\\SYSTEM\\Setup\\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f',
  'reg.exe add "HKLM\\SYSTEM\\Setup\\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f'
];
var getWindowsPeCmds = (params = {}) => {
  const commands = [];
  if (params.BypassRequirementsCheck) {
    commands.push(...BYPASS_REQUIREMENTS);
  }
  if (params.PartitionMode === "Unattended") {
    commands.push(...getDiskpartCommands(params));
  }
  return {
    WindowsPeCmds: commands.map(escapeXml)
  };
};
var FIRST_LOGON_COMMANDS = [
  `powershell.exe -WindowStyle Normal -NoProfile -Command "Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\FirstLogon.ps1' -Raw | Invoke-Expression;"`
];
var getFirstLogonCommands = (params = {}) => ({
  FirstLogonCommands: [
    ...FIRST_LOGON_COMMANDS,
    ...params.FirstLogonCommands || []
  ]
});
var COMPACT_OS = {
  Always: "true",
  Never: "false",
  Default: ""
};
var getCompactOsMode = (params = {}) => ({
  CompactOsMode: COMPACT_OS[params.CompactOsMode || "Default"] || ""
});
var getWindowsPeParams = (params) => ({
  ...getDefaultDiskParams(),
  ...params,
  ...getWindowsPeCmds(params),
  ...getFirstLogonCommands(params),
  ...getCompactOsMode(params)
});

// config/_desktop-icons.ts
var DESKTOP_ICONS = {
  Music: "{1cf1260c-4dd0-4ebb-811f-33c572699fde}",
  ThisPC: "{20d04fe0-3aea-1069-a2d8-08002b30309d}",
  Downloads: "{374de290-123f-4565-9164-39c4925e467b}",
  Pictures: "{3add1653-eb32-4cb0-bbd7-dfa0abb5acca}",
  ControlPanel: "{5399e694-6ce5-4d6c-8fce-1d8870fdcba0}",
  UserFiles: "{59031a47-3f72-44a7-89c5-5595fe6b30ee}",
  RecycleBin: "{645ff040-5081-101b-9f08-00aa002f954e}",
  Videos: "{a0953c92-50dc-43bf-be83-3742fed03c9c}",
  Documents: "{a8cdff1c-4878-43be-b5fd-f8091c1c60d0}",
  Desktop: "{b4bfcc3a-db2c-424c-b029-7fe99a87c641}",
  Gallery: "{e88865ea-0e1c-4e20-9aa6-edcd0212c87c}",
  Network: "{f02c1a0d-be21-4350-88b0-7367fc96ef3c}",
  Home: "{f874310e-b6b7-47dc-bc84-b9e6b38f5903}"
};
var _getDesktopIcon = ([key, value]) => {
  const name = DESKTOP_ICONS[key];
  if (!name) throw new Error(`Desktop icon '${key}' not found`);
  return toDword([
    name,
    value
  ]);
};
var getDesktopIcons = (params) => ({
  DesktopIcons: (params.DesktopIcons || []).map(_getDesktopIcon).filter(Boolean)
});

// config/_generic-keys.ts
var GENERIC_KEYS = {
  // -- General Availability Channel -- -- --
  "Windows 10,11 Pro": "VK7JG-NPHTM-C97JM-9MPGT-3V66T",
  "Windows 10,11 Pro N": "MH37W-N47XK-V7XM9-C7227-GCQG9",
  "Windows 10,11 Pro for Workstations": "NRG8B-VKK3Q-CXVCJ-9G2XF-6Q84J",
  "Windows 10,11 Pro for Workstations N": "9FNHH-K3HBT-3W4TD-6383H-6XYWF",
  "Windows 10,11 Pro Education": "6TP4R-GNPTD-KYYHQ-7B7DP-J447Y",
  "Windows 10,11 Pro Education N": "YVWGF-BXNMC-HTQYQ-CPQ99-66QFC",
  "Windows 10,11 Education": "NW6C2-QMPVW-D7KKK-3GKT6-VCFB2",
  "Windows 10,11 Education N": "2WH4N-8QGBV-H22JP-CT43Q-MDWWJ",
  "Windows 10,11 Enterprise": "NPPR9-FWDCX-D2C8J-H872K-2YT43",
  "Windows 10,11 Enterprise N": "DPH2V-TTNVB-4X9Q3-TJR4H-KHJW4",
  "Windows 10,11 Enterprise G": "YYVX9-NTFWV-6MDM3-9PT4T-4M68B",
  "Windows 10,11 Enterprise G N": "44RPN-FTY23-9VTTB-MP9BX-T84FV",
  // -- Long-Term Servicing Channel -- -- --
  "Windows 10,11 Enterprise LTSC 2019,2021,2024": "M7XTQ-FN8P6-TTKYV-9D4CC-J462D",
  "Windows 10,11 Enterprise N LTSC 2019,2021,2024": "92NFX-8DJQP-P6BBQ-THF9C-7CG2H",
  "Windows IoT Enterprise LTSC 2021,2024": "KBN8V-HFGQ4-MGXVD-347P6-PDQGT",
  // -- Long-Term Servicing Branch -- -- --
  "Windows 10 Enterprise LTSB 2016": "DCPHK-NFMTC-H88MJ-PFHPY-QJ4BJ",
  "Windows 10 Enterprise N LTSB 2016": "QFFDN-GRT3P-VKWWX-X7T3R-8B639",
  "Windows 10 Enterprise LTSB 2015": "WNMTR-4C88C-JK8YV-HQ7T2-76DF9",
  "Windows 10 Enterprise N LTSB 2015": "2F77B-TNFGY-69QQF-B8YKP-D69TJ",
  // -- Windows Server LTSC -- -- --
  "Windows Server 2025 Standard": "TVRH6-WHNXV-R9WG3-9XRFY-MY832",
  "Windows Server 2025 Datacenter": "D764K-2NDRG-47T6Q-P8T8W-YP6DF",
  "Windows Server 2025 Datacenter: Azure Edition": "XGN3F-F394H-FD2MY-PP6FD-8MCRC",
  "Windows Server 2022 Standard": "VDYBN-27WPP-V4HQT-9VMD4-VMK7H",
  "Windows Server 2022 Datacenter": "WX4NM-KYWYW-QJJR4-XV3QB-6VM33",
  "Windows Server 2022 Datacenter: Azure Edition": "NTBV8-9K7Q8-V27C6-M2BTV-KHMXV",
  "Windows Server 2019 Standard": "N69G4-B89J2-4G8F4-WWYCC-J464C",
  "Windows Server 2019 Datacenter": "WMDGN-G9PQG-XVVXX-R3X43-63DFG",
  "Windows Server 2019 Essentials": "WVDHN-86M7X-466P6-VHXV7-YY726",
  "Windows Server 2016 Standard": "WC2BQ-8NRM3-FDDYY-2BFGV-KHKQY",
  "Windows Server 2016 Datacenter": "CB7KF-BWN84-R7R2Y-793K2-8XDDG",
  "Windows Server 2016 Essentials": "JCKRF-N37P4-C2D82-9YXRT-4M63B",
  // -- Windows Server Semi-Annual Channel -- -- --
  "Windows Server Standard": "N2KJX-J94YW-TQVFB-DG9YT-724CC",
  "Windows Server Datacenter": "6NMRW-2C8FM-D24W7-TQWMY-CWH2D"
};
var _getGenericKey = (key) => {
  if (!key) return void 0;
  const name = GENERIC_KEYS[key];
  if (!name) throw new Error(`Generic activation key ${key} wasn't found`);
  return name;
};
var getGenericKeys = (params) => {
  if (params.ProductKey) return {
    ProductKey: params.ProductKey
  };
  if (params.GenericKey) return {
    ProductKey: _getGenericKey(params.GenericKey)
  };
  return {};
};

// config/_locales.ts
var LOCALES = {
  "Afrikaans": {
    LanguageName: "af-ZA",
    InputLocale: "0436:00000409"
  },
  "Afrikaans (Namibia)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Albanian": {
    LanguageName: "sq-AL",
    InputLocale: "041C:0000041C"
  },
  "Albanian (Kosovo)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Alsatian (France)": {
    LanguageName: "gsw-FR",
    InputLocale: "0484:0000040C"
  },
  "Amharic": {
    LanguageName: "am-ET",
    InputLocale: "045E:{7C472071-36A7-4709-88CC-859513E583A9}{9A4E8FC7-76BF-4A63-980D-FADDADF7E987}"
  },
  "Arabic": {
    LanguageName: "ar-SA",
    InputLocale: "0401:00000401"
  },
  "Arabic (Algeria)": {
    LanguageName: "ar-DZ",
    InputLocale: "1401:00020401"
  },
  "Arabic (Bahrain)": {
    LanguageName: "ar-BH",
    InputLocale: "3C01:00000401"
  },
  "Arabic (Egypt)": {
    LanguageName: "ar-EG",
    InputLocale: "0C01:00000401"
  },
  "Arabic (Iraq)": {
    LanguageName: "ar-IQ",
    InputLocale: "0801:00000401"
  },
  "Arabic (Jordan)": {
    LanguageName: "ar-JO",
    InputLocale: "2C01:00000401"
  },
  "Arabic (Kuwait)": {
    LanguageName: "ar-KW",
    InputLocale: "3401:00000401"
  },
  "Arabic (Lebanon)": {
    LanguageName: "ar-LB",
    InputLocale: "3001:00000401"
  },
  "Arabic (Libya)": {
    LanguageName: "ar-LY",
    InputLocale: "1001:00000401"
  },
  "Arabic (Morocco)": {
    LanguageName: "ar-MA",
    InputLocale: "1801:00020401"
  },
  "Arabic (Oman)": {
    LanguageName: "ar-OM",
    InputLocale: "2001:00000401"
  },
  "Arabic (Qatar)": {
    LanguageName: "ar-QA",
    InputLocale: "4001:00000401"
  },
  "Arabic (Syria)": {
    LanguageName: "ar-SY",
    InputLocale: "2801:00000401"
  },
  "Arabic (Tunisia)": {
    LanguageName: "ar-TN",
    InputLocale: "1C01:00020401"
  },
  "Arabic (United Arab Emirates)": {
    LanguageName: "ar-AE",
    InputLocale: "3801:00000401"
  },
  "Arabic (World)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Arabic (Yemen)": {
    LanguageName: "ar-YE",
    InputLocale: "2401:00000401"
  },
  "Armenian": {
    LanguageName: "hy-AM",
    InputLocale: "042B:0002042B"
  },
  "Assamese": {
    LanguageName: "as-IN",
    InputLocale: "044D:0000044D"
  },
  "Asturian": {
    LanguageName: "es-ES_tradnl",
    InputLocale: "040A:0000040A"
  },
  "Azerbaijani": {
    LanguageName: "az-Latn-AZ",
    InputLocale: "042C:0000042C"
  },
  "Azerbaijani (Cyrillic)": {
    LanguageName: "az-Cyrl-AZ",
    InputLocale: "082C:0000082C"
  },
  "Bangla": {
    LanguageName: "bn-BD",
    InputLocale: "0845:00000445"
  },
  "Bashkir": {
    LanguageName: "ba-RU",
    InputLocale: "046D:0000046D"
  },
  "Basque": {
    LanguageName: "eu-ES",
    InputLocale: "042D:0000040A"
  },
  "Belarusian": {
    LanguageName: "be-BY",
    InputLocale: "0423:00000423"
  },
  "Bengali (India)": {
    LanguageName: "bn-IN",
    InputLocale: "0445:00020445"
  },
  "Bodo": {
    LanguageName: "hi-IN",
    InputLocale: "0439:00000439"
  },
  "Bosnian": {
    LanguageName: "bs-Latn-BA",
    InputLocale: "141A:0000041A"
  },
  "Bosnian (Cyrillic)": {
    LanguageName: "bs-Cyrl-BA",
    InputLocale: "201A:0000201A"
  },
  "Breton": {
    LanguageName: "br-FR",
    InputLocale: "047E:0000040C"
  },
  "Bulgarian": {
    LanguageName: "bg-BG",
    InputLocale: "0402:00030402"
  },
  "Burmese": {
    LanguageName: "my-MM",
    InputLocale: "0455:00130C00"
  },
  "Catalan": {
    LanguageName: "ca-ES",
    InputLocale: "0403:0000040A"
  },
  "Catalan (Andorra)": {
    LanguageName: "fr-FR",
    InputLocale: "040C:0000040C"
  },
  "Catalan (France)": {
    LanguageName: "fr-FR",
    InputLocale: "040C:0000040C"
  },
  "Catalan (Italy)": {
    LanguageName: "it-IT",
    InputLocale: "0410:00000410"
  },
  "Central Atlas Tamazight": {
    LanguageName: "tzm-Latn-DZ",
    InputLocale: "085F:0000085F"
  },
  "Central Atlas Tamazight (Arabic)": {
    LanguageName: "ar-MA",
    InputLocale: "1801:00020401"
  },
  "Central Atlas Tamazight (Tifinagh)": {
    LanguageName: "tzm-Tfng-MA",
    InputLocale: "105F:0000105F"
  },
  "Central Kurdish": {
    LanguageName: "ku-Arab-IQ",
    InputLocale: "0492:00000492"
  },
  "Chechen": {
    LanguageName: "ru-RU",
    InputLocale: "0419:00000419"
  },
  "Cherokee": {
    LanguageName: "chr-Cher-US",
    InputLocale: "045C:0000045C"
  },
  "Chinese": {
    LanguageName: "zh-CN",
    InputLocale: "0804:{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}{FA550B04-5AD7-411F-A5AC-CA038EC515D7}"
  },
  "Chinese (Simplified, Hong Kong SAR)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Chinese (Simplified, Macao SAR)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Chinese (Traditional)": {
    LanguageName: "zh-TW",
    InputLocale: "0404:{531FDEBF-9B4C-4A43-A2AA-960E8FCDC732}{6024B45F-5C54-11D4-B921-0080C882687E}"
  },
  "Chinese (Traditional, Taiwan)": {
    LanguageName: "zh-TW",
    InputLocale: "0404:{B115690A-EA02-48D5-A231-E3578D2FDF80}{B2F9C502-1742-11D4-9790-0080C882687E}"
  },
  "Church Slavic": {
    LanguageName: "ru-RU",
    InputLocale: "0419:00000419"
  },
  "Colognian": {
    LanguageName: "de-DE",
    InputLocale: "0407:00000407"
  },
  "Cornish": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "Corsican": {
    LanguageName: "co-FR",
    InputLocale: "0483:0000040C"
  },
  "Croatian": {
    LanguageName: "hr-HR",
    InputLocale: "041A:0000041A"
  },
  "Croatian (Bosnia & Herzegovina)": {
    LanguageName: "hr-BA",
    InputLocale: "101A:0000041A"
  },
  "Czech": {
    LanguageName: "cs-CZ",
    InputLocale: "0405:00000405"
  },
  "Danish": {
    LanguageName: "da-DK",
    InputLocale: "0406:00000406"
  },
  "Danish (Greenland)": {
    LanguageName: "da-DK",
    InputLocale: "0406:00000406"
  },
  "Divehi": {
    LanguageName: "dv-MV",
    InputLocale: "0465:00000465"
  },
  "Dutch": {
    LanguageName: "nl-NL",
    InputLocale: "0413:00020409"
  },
  "Dutch (Aruba)": {
    LanguageName: "en-US",
    InputLocale: "0409:00020409"
  },
  "Dutch (Belgium)": {
    LanguageName: "nl-BE",
    InputLocale: "0813:00000813"
  },
  "Dutch (Bonaire, Sint Eustatius and Saba)": {
    LanguageName: "en-US",
    InputLocale: "0409:00020409"
  },
  "Dutch (Cura\u03C4ao)": {
    LanguageName: "en-US",
    InputLocale: "0409:00020409"
  },
  "Dutch (Sint Maarten)": {
    LanguageName: "en-US",
    InputLocale: "0409:00020409"
  },
  "Dutch (Suriname)": {
    LanguageName: "en-US",
    InputLocale: "0409:00020409"
  },
  "Dzongkha": {
    LanguageName: "dz-BT",
    InputLocale: "0C51:00000C51"
  },
  "English": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "English (Australia)": {
    LanguageName: "en-AU",
    InputLocale: "0C09:00000409"
  },
  "English (Austria)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000407"
  },
  "English (Belgium)": {
    LanguageName: "fr-BE",
    InputLocale: "080C:0000080C"
  },
  "English (Belize)": {
    LanguageName: "en-BZ",
    InputLocale: "2809:00000409"
  },
  "English (British Virgin Islands)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Burundi)": {
    LanguageName: "en-GB",
    InputLocale: "0809:0000040C"
  },
  "English (Canada)": {
    LanguageName: "en-CA",
    InputLocale: "1009:00000409"
  },
  "English (Caribbean)": {
    LanguageName: "en-029",
    InputLocale: "2409:00000409"
  },
  "English (Denmark)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000406"
  },
  "English (Falkland Islands)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Finland)": {
    LanguageName: "en-GB",
    InputLocale: "0809:0000040B"
  },
  "English (Germany)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000407"
  },
  "English (Gibraltar)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Guernsey)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Hong Kong SAR)": {
    LanguageName: "en-HK",
    InputLocale: "3C09:00000409"
  },
  "English (India)": {
    LanguageName: "en-IN",
    InputLocale: "4009:00004009"
  },
  "English (Ireland)": {
    LanguageName: "en-IE",
    InputLocale: "1809:00001809"
  },
  "English (Isle of Man)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Israel)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "English (Jamaica)": {
    LanguageName: "en-JM",
    InputLocale: "2009:00000409"
  },
  "English (Jersey)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Malaysia)": {
    LanguageName: "en-MY",
    InputLocale: "4409:00000409"
  },
  "English (Malta)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Netherlands)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00020409"
  },
  "English (New Zealand)": {
    LanguageName: "en-NZ",
    InputLocale: "1409:00001409"
  },
  "English (Philippines)": {
    LanguageName: "en-PH",
    InputLocale: "3409:00000409"
  },
  "English (Singapore)": {
    LanguageName: "en-SG",
    InputLocale: "4809:00000409"
  },
  "English (Slovenia)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000424"
  },
  "English (South Africa)": {
    LanguageName: "en-ZA",
    InputLocale: "1C09:00000409"
  },
  "English (Sweden)": {
    LanguageName: "en-GB",
    InputLocale: "0809:0000041D"
  },
  "English (Switzerland)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000407"
  },
  "English (Trinidad & Tobago)": {
    LanguageName: "en-TT",
    InputLocale: "2C09:00000409"
  },
  "English (United Kingdom)": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "English (Zimbabwe)": {
    LanguageName: "en-ZW",
    InputLocale: "3009:00000409"
  },
  "Estonian": {
    LanguageName: "et-EE",
    InputLocale: "0425:00000425"
  },
  "Faroese": {
    LanguageName: "fo-FO",
    InputLocale: "0438:00000406"
  },
  "Filipino": {
    LanguageName: "fil-PH",
    InputLocale: "0464:00000409"
  },
  "Finnish": {
    LanguageName: "fi-FI",
    InputLocale: "040B:0000040B"
  },
  "French": {
    LanguageName: "fr-FR",
    InputLocale: "040C:0000040C"
  },
  "French (Belgium)": {
    LanguageName: "fr-BE",
    InputLocale: "080C:0000080C"
  },
  "French (Cameroon)": {
    LanguageName: "fr-CM",
    InputLocale: "2C0C:0000040C"
  },
  "French (Canada)": {
    LanguageName: "fr-CA",
    InputLocale: "0C0C:00001009"
  },
  "French (C\xF4te d'Ivoire)": {
    LanguageName: "fr-CI",
    InputLocale: "300C:0000040C"
  },
  "French (Haiti)": {
    LanguageName: "fr-HT",
    InputLocale: "3C0C:0000040C"
  },
  "French (Luxembourg)": {
    LanguageName: "fr-LU",
    InputLocale: "140C:0000100C"
  },
  "French (Mali)": {
    LanguageName: "fr-ML",
    InputLocale: "340C:0000040C"
  },
  "French (Monaco)": {
    LanguageName: "fr-MC",
    InputLocale: "180C:0000040C"
  },
  "French (Morocco)": {
    LanguageName: "fr-MA",
    InputLocale: "380C:0000040C"
  },
  "French (R\u0398union)": {
    LanguageName: "fr-RE",
    InputLocale: "200C:0000040C"
  },
  "French (Senegal)": {
    LanguageName: "fr-SN",
    InputLocale: "280C:0000040C"
  },
  "French (Switzerland)": {
    LanguageName: "fr-CH",
    InputLocale: "100C:0000100C"
  },
  "French Congo (DRC)": {
    LanguageName: "fr-CD",
    InputLocale: "240C:0000040C"
  },
  "Friulian": {
    LanguageName: "it-IT",
    InputLocale: "0410:00000410"
  },
  "Fulah": {
    LanguageName: "ff-Latn-SN",
    InputLocale: "0867:00000488"
  },
  "Fulah (Adlam)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Fulah (Latin, Burkina Faso)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Fulah (Latin, Cameroon)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Gambia)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Ghana)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Guinea)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Guinea-Bissau)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Liberia)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Mauritania)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Niger)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Nigeria)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Fulah (Latin, Sierra Leone)": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Galician": {
    LanguageName: "gl-ES",
    InputLocale: "0456:0000040A"
  },
  "Georgian": {
    LanguageName: "ka-GE",
    InputLocale: "0437:00010437"
  },
  "German": {
    LanguageName: "de-DE",
    InputLocale: "0407:00000407"
  },
  "German (Austria)": {
    LanguageName: "de-AT",
    InputLocale: "0C07:00000407"
  },
  "German (Belgium)": {
    LanguageName: "fr-BE",
    InputLocale: "080C:0000080C"
  },
  "German (Italy)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "German (Liechtenstein)": {
    LanguageName: "de-LI",
    InputLocale: "1407:00000807"
  },
  "German (Luxembourg)": {
    LanguageName: "de-LU",
    InputLocale: "1007:00000407"
  },
  "German (Switzerland)": {
    LanguageName: "de-CH",
    InputLocale: "0807:00000807"
  },
  "Greek": {
    LanguageName: "el-GR",
    InputLocale: "0408:00000408"
  },
  "Guarani": {
    LanguageName: "gn-PY",
    InputLocale: "0474:00000474"
  },
  "Gujarati": {
    LanguageName: "gu-IN",
    InputLocale: "0447:00000447"
  },
  "Hausa": {
    LanguageName: "ha-Latn-NG",
    InputLocale: "0468:00000468"
  },
  "Hawaiian": {
    LanguageName: "haw-US",
    InputLocale: "0475:00000475"
  },
  "Hebrew": {
    LanguageName: "he-IL",
    InputLocale: "040D:0002040D"
  },
  "Hindi": {
    LanguageName: "hi-IN",
    InputLocale: "0439:00010439"
  },
  "Hungarian": {
    LanguageName: "hu-HU",
    InputLocale: "040E:0000040E"
  },
  "Icelandic": {
    LanguageName: "is-IS",
    InputLocale: "040F:0000040F"
  },
  "Igbo": {
    LanguageName: "ig-NG",
    InputLocale: "0470:00000470"
  },
  "Indonesian": {
    LanguageName: "id-ID",
    InputLocale: "0421:00000409"
  },
  "Interlingua": {
    LanguageName: "fr-FR",
    InputLocale: "040C:0000040C"
  },
  "Inuktitut": {
    LanguageName: "iu-Latn-CA",
    InputLocale: "085D:0000085D"
  },
  "Inuktitut (Syllabics)": {
    LanguageName: "iu-Cans-CA",
    InputLocale: "045D:0001045D"
  },
  "Irish": {
    LanguageName: "ga-IE",
    InputLocale: "083C:00001809"
  },
  "Irish (United Kingdom)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Italian": {
    LanguageName: "it-IT",
    InputLocale: "0410:00000410"
  },
  "Italian (Switzerland)": {
    LanguageName: "it-CH",
    InputLocale: "0810:0000100C"
  },
  "Italian (Vatican City)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Japanese": {
    LanguageName: "ja-JP",
    InputLocale: "0411:{03B5835F-F03C-411B-9CE2-AA23E1171E36}{A76C93D9-5523-4E90-AAFA-4DB112F9AC76}"
  },
  "Javanese": {
    LanguageName: "jv",
    InputLocale: "0C00:00000409"
  },
  "Javanese (Javanese)": {
    LanguageName: "jv-Java",
    InputLocale: "0C00:00110C00"
  },
  "Kalaallisut": {
    LanguageName: "kl-GL",
    InputLocale: "046F:00000406"
  },
  "Kannada": {
    LanguageName: "kn-IN",
    InputLocale: "044B:0000044B"
  },
  "Kashmiri": {
    LanguageName: "ur-PK",
    InputLocale: "0420:00000420"
  },
  "Kashmiri (Devanagari)": {
    LanguageName: "hi-IN",
    InputLocale: "0439:00010439"
  },
  "Kazakh": {
    LanguageName: "kk-KZ",
    InputLocale: "043F:0000043F"
  },
  "Khmer": {
    LanguageName: "km-KH",
    InputLocale: "0453:00000453"
  },
  "Kinyarwanda": {
    LanguageName: "rw-RW",
    InputLocale: "0487:00000409"
  },
  "Kiswahili": {
    LanguageName: "sw-KE",
    InputLocale: "0441:00000409"
  },
  "Kiswahili (Congo DRC)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Kiswahili (Tanzania)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Kiswahili (Uganda)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Konkani": {
    LanguageName: "kok-IN",
    InputLocale: "0457:00000439"
  },
  "Korean": {
    LanguageName: "ko-KR",
    InputLocale: "0412:{A028AE76-01B1-46C2-99C4-ACD9858AE02F}{B5FE1F02-D5F2-4445-9C03-C568F23C99A1}"
  },
  "Korean (North Korea)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Kyrgyz": {
    LanguageName: "ky-KG",
    InputLocale: "0440:00000440"
  },
  "K'iche'": {
    LanguageName: "quc-Latn-GT",
    InputLocale: "0486:0000080A"
  },
  "Lao": {
    LanguageName: "lo-LA",
    InputLocale: "0454:00000454"
  },
  "Latvian": {
    LanguageName: "lv-LV",
    InputLocale: "0426:00020426"
  },
  "Lithuanian": {
    LanguageName: "lt-LT",
    InputLocale: "0427:00010427"
  },
  "Lower Sorbian": {
    LanguageName: "dsb-DE",
    InputLocale: "082E:0002042E"
  },
  "Luxembourgish": {
    LanguageName: "lb-LU",
    InputLocale: "046E:0000046E"
  },
  "Macedonian": {
    LanguageName: "mk-MK",
    InputLocale: "042F:0001042F"
  },
  "Malagasy": {
    LanguageName: "mg",
    InputLocale: "0C00:0000040C"
  },
  "Malay": {
    LanguageName: "ms-MY",
    InputLocale: "043E:00000409"
  },
  "Malay (Brunei)": {
    LanguageName: "ms-BN",
    InputLocale: "083E:00000409"
  },
  "Malay (Indonesia)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Malay (Singapore)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Malayalam": {
    LanguageName: "ml-IN",
    InputLocale: "044C:0000044C"
  },
  "Maltese": {
    LanguageName: "mt-MT",
    InputLocale: "043A:0000043A"
  },
  "Manipuri": {
    LanguageName: "en-IN",
    InputLocale: "4009:00004009"
  },
  "Manx": {
    LanguageName: "en-GB",
    InputLocale: "0809:00000809"
  },
  "Maori": {
    LanguageName: "mi-NZ",
    InputLocale: "0481:00000481"
  },
  "Mapuche": {
    LanguageName: "arn-CL",
    InputLocale: "047A:0000080A"
  },
  "Marathi": {
    LanguageName: "mr-IN",
    InputLocale: "044E:0000044E"
  },
  "Mazanderani": {
    LanguageName: "fa-IR",
    InputLocale: "0429:00000429"
  },
  "Mohawk": {
    LanguageName: "moh-CA",
    InputLocale: "047C:00000409"
  },
  "Mongolian": {
    LanguageName: "mn-MN",
    InputLocale: "0450:00000450"
  },
  "Mongolian (Traditional Mongolian)": {
    LanguageName: "mn-Mong-CN",
    InputLocale: "0850:00010850"
  },
  "Mongolian (Traditional Mongolian, Mongolia)": {
    LanguageName: "mn-Mong-MN",
    InputLocale: "0C50:00010850"
  },
  "N'ko": {
    LanguageName: "nqo",
    InputLocale: "0C00:00090C00"
  },
  "Nepali": {
    LanguageName: "ne-NP",
    InputLocale: "0461:00000461"
  },
  "Nepali (India)": {
    LanguageName: "ne-IN",
    InputLocale: "0861:00000461"
  },
  "Northern Luri": {
    LanguageName: "ar-IQ",
    InputLocale: "0801:00000401"
  },
  "Northern Sami": {
    LanguageName: "se-NO",
    InputLocale: "043B:0000043B"
  },
  "Norwegian": {
    LanguageName: "nb-NO",
    InputLocale: "0414:00000414"
  },
  "Norwegian Nynorsk": {
    LanguageName: "nn-NO",
    InputLocale: "0814:00000414"
  },
  "Occitan": {
    LanguageName: "oc-FR",
    InputLocale: "0482:0000040C"
  },
  "Odia": {
    LanguageName: "or-IN",
    InputLocale: "0448:00000448"
  },
  "Oromo": {
    LanguageName: "om-ET",
    InputLocale: "0472:00000409"
  },
  "Oromo (Kenya)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Ossetic": {
    LanguageName: "ru-RU",
    InputLocale: "0419:00000419"
  },
  "Papiamento": {
    LanguageName: "pap-029",
    InputLocale: "0479:00000409"
  },
  "Pashto": {
    LanguageName: "ps-AF",
    InputLocale: "0463:00000463"
  },
  "Pashto (Pakistan)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Persian": {
    LanguageName: "fa-IR",
    InputLocale: "0429:00000429"
  },
  "Persian (Afghanistan)": {
    LanguageName: "fa-AF",
    InputLocale: "048C:00050429"
  },
  "Polish": {
    LanguageName: "pl-PL",
    InputLocale: "0415:00000415"
  },
  "Portuguese": {
    LanguageName: "pt-BR",
    InputLocale: "0416:00000416"
  },
  "Portuguese (Angola)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Portuguese (Cabo Verde)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Portuguese (Equatorial Guinea)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Portuguese (Guinea-Bissau)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Portuguese (Luxembourg)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Portuguese (Macao SAR)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Portuguese (Mozambique)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Portuguese (Portugal)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Portuguese (Switzerland)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Portuguese (S\u03C0o Tom\u0398 & Pr\u03C6ncipe)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Portuguese (Timor-Leste)": {
    LanguageName: "pt-PT",
    InputLocale: "0816:00000816"
  },
  "Prussian": {
    LanguageName: "de-DE",
    InputLocale: "0407:00000407"
  },
  "Punjabi (India)": {
    LanguageName: "pa-IN",
    InputLocale: "0446:00000446"
  },
  "Punjabi (Pakistan)": {
    LanguageName: "pa-Arab-PK",
    InputLocale: "0846:00000420"
  },
  "Quechua": {
    LanguageName: "quz-BO",
    InputLocale: "046B:0000080A"
  },
  "Quechua (Ecuador)": {
    LanguageName: "quz-EC",
    InputLocale: "086B:0000080A"
  },
  "Quechua (Peru)": {
    LanguageName: "quz-PE",
    InputLocale: "0C6B:0000080A"
  },
  "Romanian": {
    LanguageName: "ro-RO",
    InputLocale: "0418:00010418"
  },
  "Romanian (Moldova)": {
    LanguageName: "ro-MD",
    InputLocale: "0818:00010418"
  },
  "Romansh": {
    LanguageName: "rm-CH",
    InputLocale: "0417:00000807"
  },
  "Russian": {
    LanguageName: "ru-RU",
    InputLocale: "0419:00000419"
  },
  "Russian (Moldova)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Sakha": {
    LanguageName: "sah-RU",
    InputLocale: "0485:00000485"
  },
  "Sami (Inari)": {
    LanguageName: "smn-FI",
    InputLocale: "243B:0001083B"
  },
  "Sami (Lule)": {
    LanguageName: "smj-SE",
    InputLocale: "143B:0000083B"
  },
  "Sami (Skolt)": {
    LanguageName: "sms-FI",
    InputLocale: "203B:0001083B"
  },
  "Sami (Southern)": {
    LanguageName: "sma-SE",
    InputLocale: "1C3B:0000083B"
  },
  "Sami, Lule (Norway)": {
    LanguageName: "smj-NO",
    InputLocale: "103B:0000043B"
  },
  "Sami, Northern (Finland)": {
    LanguageName: "se-FI",
    InputLocale: "0C3B:0001083B"
  },
  "Sami, Northern (Sweden)": {
    LanguageName: "se-SE",
    InputLocale: "083B:0000083B"
  },
  "Sami, Southern (Norway)": {
    LanguageName: "sma-NO",
    InputLocale: "183B:0000043B"
  },
  "Sanskrit": {
    LanguageName: "sa-IN",
    InputLocale: "044F:00000439"
  },
  "Scottish Gaelic": {
    LanguageName: "gd-GB",
    InputLocale: "0491:00011809"
  },
  "Serbian": {
    LanguageName: "sr-Latn-RS",
    InputLocale: "241A:0000081A"
  },
  "Serbian (Cyrillic)": {
    LanguageName: "sr-Cyrl-RS",
    InputLocale: "281A:00000C1A"
  },
  "Serbian (Cyrillic, Bosnia and Herzegovina)": {
    LanguageName: "sr-Cyrl-BA",
    InputLocale: "1C1A:00000C1A"
  },
  "Serbian (Cyrillic, Kosovo)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Serbian (Cyrillic, Montenegro)": {
    LanguageName: "sr-Cyrl-ME",
    InputLocale: "301A:00000C1A"
  },
  "Serbian (Latin, Bosnia & Herzegovina)": {
    LanguageName: "sr-Latn-BA",
    InputLocale: "181A:0000081A"
  },
  "Serbian (Latin, Kosovo)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Serbian (Latin, Montenegro)": {
    LanguageName: "sr-Latn-ME",
    InputLocale: "2C1A:0000081A"
  },
  "Sesotho": {
    LanguageName: "st-ZA",
    InputLocale: "0430:00000409"
  },
  "Sesotho (Lesotho)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Sesotho sa Leboa": {
    LanguageName: "nso-ZA",
    InputLocale: "046C:0000046C"
  },
  "Setswana": {
    LanguageName: "tn-ZA",
    InputLocale: "0432:00000432"
  },
  "Setswana (Botswana)": {
    LanguageName: "tn-BW",
    InputLocale: "0832:00000432"
  },
  "Shona": {
    LanguageName: "jv",
    InputLocale: "0C00:00000409"
  },
  "Sindhi": {
    LanguageName: "sd-Arab-PK",
    InputLocale: "0859:00000420"
  },
  "Sindhi (Devanagari)": {
    LanguageName: "hi-IN",
    InputLocale: "0439:00010439"
  },
  "Sinhala": {
    LanguageName: "si-LK",
    InputLocale: "045B:0000045B"
  },
  "Slovak": {
    LanguageName: "sk-SK",
    InputLocale: "041B:0000041B"
  },
  "Slovenian": {
    LanguageName: "sl-SI",
    InputLocale: "0424:00000424"
  },
  "Somali": {
    LanguageName: "so-SO",
    InputLocale: "0477:00000409"
  },
  "Somali (Djibouti)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Somali (Ethiopia)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Somali (Kenya)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Spanish": {
    LanguageName: "es-ES",
    InputLocale: "0C0A:0000040A"
  },
  "Spanish (Argentina)": {
    LanguageName: "es-AR",
    InputLocale: "2C0A:0000080A"
  },
  "Spanish (Belize)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Spanish (Bolivia)": {
    LanguageName: "es-BO",
    InputLocale: "400A:0000080A"
  },
  "Spanish (Brazil)": {
    LanguageName: "en-US",
    InputLocale: "0409:00000409"
  },
  "Spanish (Chile)": {
    LanguageName: "es-CL",
    InputLocale: "340A:0000080A"
  },
  "Spanish (Colombia)": {
    LanguageName: "es-CO",
    InputLocale: "240A:0000080A"
  },
  "Spanish (Costa Rica)": {
    LanguageName: "es-CR",
    InputLocale: "140A:0000080A"
  },
  "Spanish (Cuba)": {
    LanguageName: "es-MX",
    InputLocale: "080A:0000080A"
  },
  "Spanish (Dominican Republic)": {
    LanguageName: "es-DO",
    InputLocale: "1C0A:0000080A"
  },
  "Spanish (Ecuador)": {
    LanguageName: "es-EC",
    InputLocale: "300A:0000080A"
  },
  "Spanish (El Salvador)": {
    LanguageName: "es-SV",
    InputLocale: "440A:0000080A"
  },
  "Spanish (Equatorial Guinea)": {
    LanguageName: "es-MX",
    InputLocale: "080A:0000080A"
  },
  "Spanish (Guatemala)": {
    LanguageName: "es-GT",
    InputLocale: "100A:0000080A"
  },
  "Spanish (Honduras)": {
    LanguageName: "es-HN",
    InputLocale: "480A:0000080A"
  },
  "Spanish (Latin America)": {
    LanguageName: "es-419",
    InputLocale: "580A:0000080A"
  },
  "Spanish (Mexico)": {
    LanguageName: "es-MX",
    InputLocale: "080A:0000080A"
  },
  "Spanish (Nicaragua)": {
    LanguageName: "es-NI",
    InputLocale: "4C0A:0000080A"
  },
  "Spanish (Panama)": {
    LanguageName: "es-PA",
    InputLocale: "180A:0000080A"
  },
  "Spanish (Paraguay)": {
    LanguageName: "es-PY",
    InputLocale: "3C0A:0000080A"
  },
  "Spanish (Peru)": {
    LanguageName: "es-PE",
    InputLocale: "280A:0000080A"
  },
  "Spanish (Philippines)": {
    LanguageName: "es-MX",
    InputLocale: "080A:0000080A"
  },
  "Spanish (Puerto Rico)": {
    LanguageName: "es-PR",
    InputLocale: "500A:0000080A"
  },
  "Spanish (United States)": {
    LanguageName: "es-US",
    InputLocale: "540A:0000080A"
  },
  "Spanish (Uruguay)": {
    LanguageName: "es-UY",
    InputLocale: "380A:0000080A"
  },
  "Spanish (Venezuela)": {
    LanguageName: "es-VE",
    InputLocale: "200A:0000080A"
  },
  "Standard Moroccan Tamazight": {
    LanguageName: "zgh",
    InputLocale: "0C00:0000105F"
  },
  "Swedish": {
    LanguageName: "sv-SE",
    InputLocale: "041D:0000041D"
  },
  "Swedish (Finland)": {
    LanguageName: "sv-FI",
    InputLocale: "081D:0000041D"
  },
  "Swiss German": {
    LanguageName: "de-CH",
    InputLocale: "0807:00000807"
  },
  "Syriac": {
    LanguageName: "syr-SY",
    InputLocale: "045A:0000045A"
  },
  "Tachelhit": {
    LanguageName: "tzm-Tfng-MA",
    InputLocale: "105F:0000105F"
  },
  "Tachelhit (Latin)": {
    LanguageName: "tzm-Latn-DZ",
    InputLocale: "085F:0000085F"
  },
  "Tajik": {
    LanguageName: "tg-Cyrl-TJ",
    InputLocale: "0428:00000428"
  },
  "Tamil": {
    LanguageName: "ta-IN",
    InputLocale: "0449:00020449"
  },
  "Tamil (Malaysia)": {
    LanguageName: "ta-IN",
    InputLocale: "0449:00020449"
  },
  "Tamil (Singapore)": {
    LanguageName: "ta-IN",
    InputLocale: "0449:00020449"
  },
  "Tamil (Sri Lanka)": {
    LanguageName: "ta-LK",
    InputLocale: "0849:00020449"
  },
  "Tatar": {
    LanguageName: "tt-RU",
    InputLocale: "0444:00010444"
  },
  "Telugu": {
    LanguageName: "te-IN",
    InputLocale: "044A:0000044A"
  },
  "Thai": {
    LanguageName: "th-TH",
    InputLocale: "041E:0000041E"
  },
  "Tibetan": {
    LanguageName: "bo-CN",
    InputLocale: "0451:00010451"
  },
  "Tibetan (India)": {
    LanguageName: "bo-CN",
    InputLocale: "0451:00000451"
  },
  "Tigrinya": {
    LanguageName: "ti-ET",
    InputLocale: "0473:{E429B25A-E5D3-4D1F-9BE3-0C608477E3A1}{3CAB88B7-CC3E-46A6-9765-B772AD7761FF}"
  },
  "Turkish": {
    LanguageName: "tr-TR",
    InputLocale: "041F:0000041F"
  },
  "Turkmen": {
    LanguageName: "tk-TM",
    InputLocale: "0442:00000442"
  },
  "Ukrainian": {
    LanguageName: "uk-UA",
    InputLocale: "0422:00000422"
  },
  "Ukrainian (Enhanced)": {
    LanguageName: "uk-UA",
    InputLocale: "0422:00020422"
  },
  "Upper Sorbian": {
    LanguageName: "hsb-DE",
    InputLocale: "042E:0002042E"
  },
  "Urdu": {
    LanguageName: "ur-PK",
    InputLocale: "0420:00000420"
  },
  "Urdu (India)": {
    LanguageName: "ur-IN",
    InputLocale: "0820:00000420"
  },
  "Uyghur": {
    LanguageName: "ug-CN",
    InputLocale: "0480:00010480"
  },
  "Uzbek": {
    LanguageName: "uz-Latn-UZ",
    InputLocale: "0443:00000409"
  },
  "Uzbek (Arabic)": {
    LanguageName: "ps-AF",
    InputLocale: "0463:00000463"
  },
  "Uzbek (Cyrillic)": {
    LanguageName: "uz-Cyrl-UZ",
    InputLocale: "0843:00000843"
  },
  "Valencian (Spain)": {
    LanguageName: "ca-ES-valencia",
    InputLocale: "0803:0000040A"
  },
  "Vietnamese": {
    LanguageName: "vi-VN",
    InputLocale: "042A:{C2CB2CF0-AF47-413E-9780-8BC3A3C16068}{5FB02EC5-0A77-4684-B4FA-DEF8A2195628}"
  },
  "Walser": {
    LanguageName: "de-CH",
    InputLocale: "0807:00000807"
  },
  "Welsh": {
    LanguageName: "cy-GB",
    InputLocale: "0452:00000452"
  },
  "Western Frisian": {
    LanguageName: "fy-NL",
    InputLocale: "0462:00020409"
  },
  "Wolof": {
    LanguageName: "wo-SN",
    InputLocale: "0488:00000488"
  },
  "Xitsonga": {
    LanguageName: "ts-ZA",
    InputLocale: "0431:00000409"
  },
  "Yi": {
    LanguageName: "ii-CN",
    InputLocale: "0478:{E429B25A-E5D3-4D1F-9BE3-0C608477E3A1}{409C8376-007B-4357-AE8E-26316EE3FB0D}"
  },
  "Yoruba": {
    LanguageName: "yo-NG",
    InputLocale: "046A:0000046A"
  },
  "isiXhosa": {
    LanguageName: "xh-ZA",
    InputLocale: "0434:00000409"
  },
  "isiZulu": {
    LanguageName: "zu-ZA",
    InputLocale: "0435:00000409"
  }
};
var getInputLocale = (keys = []) => keys.map((key) => {
  const locale = LOCALES[key];
  if (!locale) throw new Error(`Locale '${key}' not found`);
  return LOCALES[key].InputLocale;
}).join(";");

// config/_locations.ts
var LOCATIONS = {
  "Antigua and Barbuda": {
    LongName: "Antigua and Barbuda",
    Id: 2
  },
  "Afghanistan": {
    LongName: "Islamic Republic of Afghanistan",
    Id: 3
  },
  "Algeria": {
    LongName: "Democratic and Popular Republic of Algeria",
    Id: 4
  },
  "Azerbaijan": {
    LongName: "Republic of Azerbaijan",
    Id: 5
  },
  "Albania": {
    LongName: "Republic of Albania",
    Id: 6
  },
  "Armenia": {
    LongName: "Republic of Armenia",
    Id: 7
  },
  "Andorra": {
    LongName: "Principality of Andorra",
    Id: 8
  },
  "Angola": {
    LongName: "Republic of Angola",
    Id: 9
  },
  "American Samoa": {
    LongName: "Territory of American Samoa",
    Id: 10
  },
  "Argentina": {
    LongName: "Argentine Republic",
    Id: 11
  },
  "Australia": {
    LongName: "Commonwealth of Australia",
    Id: 12
  },
  "Austria": {
    LongName: "Republic of Austria",
    Id: 14
  },
  "Bahrain": {
    LongName: "Kingdom of Bahrain",
    Id: 17
  },
  "Barbados": {
    LongName: "Barbados",
    Id: 18
  },
  "Botswana": {
    LongName: "Republic of Botswana",
    Id: 19
  },
  "Bermuda": {
    LongName: "Bermuda",
    Id: 20
  },
  "Belgium": {
    LongName: "Kingdom of Belgium",
    Id: 21
  },
  "Bahamas, The": {
    LongName: "Commonwealth of The Bahamas",
    Id: 22
  },
  "Bangladesh": {
    LongName: "People's Republic of Bangladesh",
    Id: 23
  },
  "Belize": {
    LongName: "Belize",
    Id: 24
  },
  "Bosnia and Herzegovina": {
    LongName: "Bosnia and Herzegovina",
    Id: 25
  },
  "Bolivia": {
    LongName: 'Plurinational State of Bolivia"',
    Id: 26
  },
  "Myanmar": {
    LongName: "Republic of the Union of Myanmar",
    Id: 27
  },
  "Benin": {
    LongName: "Republic of Benin",
    Id: 28
  },
  "Belarus": {
    LongName: "Republic of Belarus",
    Id: 29
  },
  "Solomon Islands": {
    LongName: "Solomon Islands",
    Id: 30
  },
  "Brazil": {
    LongName: "Federative Republic of Brazil",
    Id: 32
  },
  "Bhutan": {
    LongName: "Kingdom of Bhutan",
    Id: 34
  },
  "Bulgaria": {
    LongName: "Republic of Bulgaria",
    Id: 35
  },
  "Brunei": {
    LongName: "Negara Brunei Darussalam",
    Id: 37
  },
  "Burundi": {
    LongName: "Republic of Burundi",
    Id: 38
  },
  "Canada": {
    LongName: "Canada",
    Id: 39
  },
  "Cambodia": {
    LongName: "Kingdom of Cambodia",
    Id: 40
  },
  "Chad": {
    LongName: "Republic of Chad",
    Id: 41
  },
  "Sri Lanka": {
    LongName: "Democratic Socialist Republic of Sri Lanka",
    Id: 42
  },
  "Congo": {
    LongName: "Republic of the Congo",
    Id: 43
  },
  "Congo (DRC)": {
    LongName: "Democratic Republic of the Congo",
    Id: 44
  },
  "China": {
    LongName: "People's Republic of China",
    Id: 45
  },
  "Chile": {
    LongName: "Republic of Chile",
    Id: 46
  },
  "Cameroon": {
    LongName: "Republic of Cameroon",
    Id: 49
  },
  "Comoros": {
    LongName: "Union of Comoros",
    Id: 50
  },
  "Colombia": {
    LongName: "Republic of Colombia",
    Id: 51
  },
  "Costa Rica": {
    LongName: "Republic of Costa Rica",
    Id: 54
  },
  "Central African Republic": {
    LongName: "Central African Republic",
    Id: 55
  },
  "Cuba": {
    LongName: "Republic of Cuba",
    Id: 56
  },
  "Cabo Verde": {
    LongName: "Republic of Cabo Verde",
    Id: 57
  },
  "Cyprus": {
    LongName: "Republic of Cyprus",
    Id: 59
  },
  "Denmark": {
    LongName: "Kingdom of Denmark",
    Id: 61
  },
  "Djibouti": {
    LongName: "Republic of Djibouti",
    Id: 62
  },
  "Dominica": {
    LongName: "Commonwealth of Dominica",
    Id: 63
  },
  "Dominican Republic": {
    LongName: "Dominican Republic",
    Id: 65
  },
  "Ecuador": {
    LongName: "Republic of Ecuador",
    Id: 66
  },
  "Egypt": {
    LongName: "Arab Republic of Egypt",
    Id: 67
  },
  "Ireland": {
    LongName: "Ireland",
    Id: 68
  },
  "Equatorial Guinea": {
    LongName: "Republic of Equatorial Guinea",
    Id: 69
  },
  "Estonia": {
    LongName: "Republic of Estonia",
    Id: 70
  },
  "Eritrea": {
    LongName: "State of Eritrea",
    Id: 71
  },
  "El Salvador": {
    LongName: "Republic of El Salvador",
    Id: 72
  },
  "Ethiopia": {
    LongName: "Federal Democratic Republic of Ethiopia",
    Id: 73
  },
  "Czech Republic": {
    LongName: "Czech Republic",
    Id: 75
  },
  "Finland": {
    LongName: "Republic of Finland",
    Id: 77
  },
  "Fiji": {
    LongName: "The Republic of Fiji",
    Id: 78
  },
  "Micronesia": {
    LongName: "Federated States of Micronesia",
    Id: 80
  },
  "Faroe Islands": {
    LongName: "Faroe Islands",
    Id: 81
  },
  "France": {
    LongName: "French Republic",
    Id: 84
  },
  "Gambia": {
    LongName: "Republic of The Gambia",
    Id: 86
  },
  "Gabon": {
    LongName: "Gabonese Republic",
    Id: 87
  },
  "Georgia": {
    LongName: "Georgia",
    Id: 88
  },
  "Ghana": {
    LongName: "Republic of Ghana",
    Id: 89
  },
  "Gibraltar": {
    LongName: "Gibraltar",
    Id: 90
  },
  "Grenada": {
    LongName: "Grenada",
    Id: 91
  },
  "Greenland": {
    LongName: "Greenland",
    Id: 93
  },
  "Germany": {
    LongName: "Federal Republic of Germany",
    Id: 94
  },
  "Greece": {
    LongName: "Hellenic Republic",
    Id: 98
  },
  "Guatemala": {
    LongName: "Republic of Guatemala",
    Id: 99
  },
  "Guinea": {
    LongName: "Republic of Guinea",
    Id: 100
  },
  "Guyana": {
    LongName: "Cooperative Republic of Guyana",
    Id: 101
  },
  "Haiti": {
    LongName: "Republic of Haiti",
    Id: 103
  },
  "Hong Kong SAR": {
    LongName: "Hong Kong Special Administrative Region",
    Id: 104
  },
  "Honduras": {
    LongName: "Republic of Honduras",
    Id: 106
  },
  "Croatia": {
    LongName: "Republic of Croatia",
    Id: 108
  },
  "Hungary": {
    LongName: "Republic of Hungary",
    Id: 109
  },
  "Iceland": {
    LongName: "Republic of Iceland",
    Id: 110
  },
  "Indonesia": {
    LongName: "Republic of Indonesia",
    Id: 111
  },
  "India": {
    LongName: "Republic of India",
    Id: 113
  },
  "British Indian Ocean Territory": {
    LongName: "British Indian Ocean Territory",
    Id: 114
  },
  "Iran": {
    LongName: "Islamic Republic of Iran",
    Id: 116
  },
  "Israel": {
    LongName: "State of Israel",
    Id: 117
  },
  "Italy": {
    LongName: "Italian Republic",
    Id: 118
  },
  "C\xF4te d'Ivoire": {
    LongName: "Republic of C\xF4te d'Ivoire",
    Id: 119
  },
  "Iraq": {
    LongName: "Republic of Iraq",
    Id: 121
  },
  "Japan": {
    LongName: "Japan",
    Id: 122
  },
  "Jamaica": {
    LongName: "Jamaica",
    Id: 124
  },
  "Jan Mayen": {
    LongName: "Jan Mayen",
    Id: 125
  },
  "Jordan": {
    LongName: "Hashemite Kingdom of Jordan",
    Id: 126
  },
  "Johnston Atoll": {
    LongName: "",
    Id: 127
  },
  "Kenya": {
    LongName: "Republic of Kenya",
    Id: 129
  },
  "Kyrgyzstan": {
    LongName: "Kyrgyz Republic",
    Id: 130
  },
  "North Korea": {
    LongName: "Democratic People's Republic of Korea",
    Id: 131
  },
  "Kiribati": {
    LongName: "Republic of Kiribati",
    Id: 133
  },
  "Korea": {
    LongName: "Republic of Korea",
    Id: 134
  },
  "Kuwait": {
    LongName: "State of Kuwait",
    Id: 136
  },
  "Kazakhstan": {
    LongName: "Republic of Kazakhstan",
    Id: 137
  },
  "Laos": {
    LongName: "Lao People's Democratic Republic",
    Id: 138
  },
  "Lebanon": {
    LongName: "Republic of Lebanon",
    Id: 139
  },
  "Latvia": {
    LongName: "Republic of Latvia",
    Id: 140
  },
  "Lithuania": {
    LongName: "Republic of Lithuania",
    Id: 141
  },
  "Liberia": {
    LongName: "Republic of Liberia",
    Id: 142
  },
  "Slovakia": {
    LongName: "Slovak Republic",
    Id: 143
  },
  "Liechtenstein": {
    LongName: "Principality of Liechtenstein",
    Id: 145
  },
  "Lesotho": {
    LongName: "Kingdom of Lesotho",
    Id: 146
  },
  "Luxembourg": {
    LongName: "Grand Duchy of Luxembourg",
    Id: 147
  },
  "Libya": {
    LongName: "Libya",
    Id: 148
  },
  "Madagascar": {
    LongName: "Republic of Madagascar",
    Id: 149
  },
  "Macao SAR": {
    LongName: "Macao Special Administrative Region",
    Id: 151
  },
  "Moldova": {
    LongName: "Republic of Moldova",
    Id: 152
  },
  "Mongolia": {
    LongName: "Mongolia",
    Id: 154
  },
  "Malawi": {
    LongName: "Republic of Malawi",
    Id: 156
  },
  "Mali": {
    LongName: "Republic of Mali",
    Id: 157
  },
  "Monaco": {
    LongName: "Principality of Monaco",
    Id: 158
  },
  "Morocco": {
    LongName: "Kingdom of Morocco",
    Id: 159
  },
  "Mauritius": {
    LongName: "Republic of Mauritius",
    Id: 160
  },
  "Mauritania": {
    LongName: "Islamic Republic of Mauritania",
    Id: 162
  },
  "Malta": {
    LongName: "Republic of Malta",
    Id: 163
  },
  "Oman": {
    LongName: "Sultanate of Oman",
    Id: 164
  },
  "Maldives": {
    LongName: "Republic of Maldives",
    Id: 165
  },
  "Mexico": {
    LongName: "United Mexican States",
    Id: 166
  },
  "Malaysia": {
    LongName: "Federation of Malaysia",
    Id: 167
  },
  "Mozambique": {
    LongName: "Republic of Mozambique",
    Id: 168
  },
  "Niger": {
    LongName: "Republic of Niger",
    Id: 173
  },
  "Vanuatu": {
    LongName: "Republic of Vanuatu",
    Id: 174
  },
  "Nigeria": {
    LongName: "Federal Republic of Nigeria",
    Id: 175
  },
  "Netherlands": {
    LongName: "Kingdom of the Netherlands",
    Id: 176
  },
  "Norway": {
    LongName: "Kingdom of Norway",
    Id: 177
  },
  "Nepal": {
    LongName: "Federal Democratic Republic of Nepal",
    Id: 178
  },
  "Nauru": {
    LongName: "Republic of Nauru",
    Id: 180
  },
  "Suriname": {
    LongName: "Republic of Suriname",
    Id: 181
  },
  "Nicaragua": {
    LongName: "Republic of Nicaragua",
    Id: 182
  },
  "New Zealand": {
    LongName: "New Zealand",
    Id: 183
  },
  "Palestinian Authority": {
    LongName: "Palestinian National Authority",
    Id: 184
  },
  "Paraguay": {
    LongName: "Republic of Paraguay",
    Id: 185
  },
  "Peru": {
    LongName: "Republic of Peru",
    Id: 187
  },
  "Pakistan": {
    LongName: "Islamic Republic of Pakistan",
    Id: 190
  },
  "Poland": {
    LongName: "Republic of Poland",
    Id: 191
  },
  "Panama": {
    LongName: "Republic of Panama",
    Id: 192
  },
  "Portugal": {
    LongName: "Portuguese Republic",
    Id: 193
  },
  "Papua New Guinea": {
    LongName: "Independent State of Papua New Guinea",
    Id: 194
  },
  "Palau": {
    LongName: "Republic of Palau",
    Id: 195
  },
  "Guinea-Bissau": {
    LongName: "Republic of Guinea-Bissau",
    Id: 196
  },
  "Qatar": {
    LongName: "State of Qatar",
    Id: 197
  },
  "R\xE9union": {
    LongName: "Department of R\xE9union",
    Id: 198
  },
  "Marshall Islands": {
    LongName: "Republic of the Marshall Islands",
    Id: 199
  },
  "Romania": {
    LongName: "Romania",
    Id: 200
  },
  "Philippines": {
    LongName: "Republic of the Philippines",
    Id: 201
  },
  "Puerto Rico": {
    LongName: "Commonwealth of Puerto Rico",
    Id: 202
  },
  "Russia": {
    LongName: "Russian Federation",
    Id: 203
  },
  "Rwanda": {
    LongName: "Republic of Rwanda",
    Id: 204
  },
  "Saudi Arabia": {
    LongName: "Kingdom of Saudi Arabia",
    Id: 205
  },
  "Saint Pierre and Miquelon": {
    LongName: "Territorial Collectivity of Saint Pierre and Miquelon",
    Id: 206
  },
  "Saint Kitts and Nevis": {
    LongName: "Federation of Saint Kitts and Nevis",
    Id: 207
  },
  "Seychelles": {
    LongName: "Republic of Seychelles",
    Id: 208
  },
  "South Africa": {
    LongName: "Republic of South Africa",
    Id: 209
  },
  "Senegal": {
    LongName: "Republic of Senegal",
    Id: 210
  },
  "Slovenia": {
    LongName: "Republic of Slovenia",
    Id: 212
  },
  "Sierra Leone": {
    LongName: "Republic of Sierra Leone",
    Id: 213
  },
  "San Marino": {
    LongName: "Republic of San Marino",
    Id: 214
  },
  "Singapore": {
    LongName: "Republic of Singapore",
    Id: 215
  },
  "Somalia": {
    LongName: "Federal Republic of Somalia",
    Id: 216
  },
  "Spain": {
    LongName: "Kingdom of Spain",
    Id: 217
  },
  "Saint Lucia": {
    LongName: "Saint Lucia",
    Id: 218
  },
  "Sudan": {
    LongName: "Republic of the Sudan",
    Id: 219
  },
  "Svalbard": {
    LongName: "Svalbard",
    Id: 220
  },
  "Sweden": {
    LongName: "Kingdom of Sweden",
    Id: 221
  },
  "Syria": {
    LongName: "Syrian Arab Republic",
    Id: 222
  },
  "Switzerland": {
    LongName: "Swiss Confederation",
    Id: 223
  },
  "United Arab Emirates": {
    LongName: "United Arab Emirates",
    Id: 224
  },
  "Trinidad and Tobago": {
    LongName: "Republic of Trinidad and Tobago",
    Id: 225
  },
  "Thailand": {
    LongName: "Kingdom of Thailand",
    Id: 227
  },
  "Tajikistan": {
    LongName: "Republic of Tajikistan",
    Id: 228
  },
  "Tonga": {
    LongName: "Kingdom of Tonga",
    Id: 231
  },
  "Togo": {
    LongName: "Togolese Republic",
    Id: 232
  },
  "S\xE3o Tom\xE9 and Pr\xEDncipe": {
    LongName: "Democratic Republic of S\xE3o Tom\xE9 and Pr\xEDncipe",
    Id: 233
  },
  "Tunisia": {
    LongName: "Tunisian Republic",
    Id: 234
  },
  "T\xFCrkiye": {
    LongName: "Republic of T\xFCrkiye",
    Id: 235
  },
  "Tuvalu": {
    LongName: "Tuvalu",
    Id: 236
  },
  "Taiwan": {
    LongName: "Taiwan",
    Id: 237
  },
  "Turkmenistan": {
    LongName: "Republic of Turkmenistan",
    Id: 238
  },
  "Tanzania": {
    LongName: "United Republic of Tanzania",
    Id: 239
  },
  "Uganda": {
    LongName: "Republic of Uganda",
    Id: 240
  },
  "Ukraine": {
    LongName: "Ukraine",
    Id: 241
  },
  "United Kingdom": {
    LongName: "United Kingdom of Great Britain and Northern Ireland",
    Id: 242
  },
  "United States": {
    LongName: "United States of America",
    Id: 244
  },
  "Burkina Faso": {
    LongName: "Burkina Faso",
    Id: 245
  },
  "Uruguay": {
    LongName: "Oriental Republic of Uruguay",
    Id: 246
  },
  "Uzbekistan": {
    LongName: "Republic of Uzbekistan",
    Id: 247
  },
  "Saint Vincent and the Grenadines": {
    LongName: "Saint Vincent and the Grenadines",
    Id: 248
  },
  "Venezuela": {
    LongName: "Bolivarian Republic of Venezuela",
    Id: 249
  },
  "Vietnam": {
    LongName: "Socialist Republic of Vietnam",
    Id: 251
  },
  "U.S. Virgin Islands": {
    LongName: "Virgin Islands of the United States",
    Id: 252
  },
  "Vatican City": {
    LongName: "State of Vatican City",
    Id: 253
  },
  "Namibia": {
    LongName: "Republic of Namibia",
    Id: 254
  },
  "Wake Island": {
    LongName: "",
    Id: 258
  },
  "Samoa": {
    LongName: "Independent State of Samoa",
    Id: 259
  },
  "Swaziland": {
    LongName: "Kingdom of Swaziland",
    Id: 260
  },
  "Yemen": {
    LongName: "Republic of Yemen",
    Id: 261
  },
  "Zambia": {
    LongName: "Republic of Zambia",
    Id: 263
  },
  "Zimbabwe": {
    LongName: "Republic of Zimbabwe",
    Id: 264
  },
  "Serbia and Montenegro (Former)": {
    LongName: "Serbia",
    Id: 269
  },
  "Montenegro": {
    LongName: "Montenegro",
    Id: 270
  },
  "Serbia": {
    LongName: "Serbia",
    Id: 271
  },
  "Cura\xE7ao": {
    LongName: "",
    Id: 273
  },
  "Anguilla": {
    LongName: "Anguilla",
    Id: 300
  },
  "South Sudan": {
    LongName: "The Republic of South Sudan",
    Id: 276
  },
  "Antarctica": {
    LongName: "Antarctica",
    Id: 301
  },
  "Aruba": {
    LongName: "Aruba",
    Id: 302
  },
  "Ascension Island": {
    LongName: "",
    Id: 303
  },
  "Ashmore and Cartier Islands": {
    LongName: "Territory of Ashmore and Cartier Islands",
    Id: 304
  },
  "Baker Island": {
    LongName: "",
    Id: 305
  },
  "Bouvet Island": {
    LongName: "",
    Id: 306
  },
  "Cayman Islands": {
    LongName: "Cayman Islands",
    Id: 307
  },
  "Channel Islands": {
    LongName: "",
    Id: 308
  },
  "Christmas Island": {
    LongName: "Territory of Christmas Island",
    Id: 309
  },
  "Clipperton Island": {
    LongName: "",
    Id: 310
  },
  "Cocos (Keeling) Islands": {
    LongName: "Territory of Cocos (Keeling) Islands",
    Id: 311
  },
  "Cook Islands": {
    LongName: "",
    Id: 312
  },
  "Coral Sea Islands": {
    LongName: "Coral Sea Islands Territory",
    Id: 313
  },
  "Diego Garcia": {
    LongName: "",
    Id: 314
  },
  "Falkland Islands": {
    LongName: "Falkland Islands",
    Id: 315
  },
  "French Guiana": {
    LongName: "Department of Guiana",
    Id: 317
  },
  "French Polynesia": {
    LongName: "Territory of French Polynesia",
    Id: 318
  },
  "French Southern Territories": {
    LongName: "Territory of the French Southern and Antarctic Lands",
    Id: 319
  },
  "Guadeloupe": {
    LongName: "Department of Guadeloupe",
    Id: 321
  },
  "Guam": {
    LongName: "Territory of Guam",
    Id: 322
  },
  "Guantanamo Bay": {
    LongName: "",
    Id: 323
  },
  "Guernsey": {
    LongName: "Bailiwick of Guernsey",
    Id: 324
  },
  "Heard Island and McDonald Islands": {
    LongName: "Territory of Heard Island and McDonald Islands",
    Id: 325
  },
  "Howland Island": {
    LongName: "",
    Id: 326
  },
  "Jarvis Island": {
    LongName: "",
    Id: 327
  },
  "Jersey": {
    LongName: "Bailiwick of Jersey",
    Id: 328
  },
  "Kingman Reef": {
    LongName: "",
    Id: 329
  },
  "Martinique": {
    LongName: "Department of Martinique",
    Id: 330
  },
  "Mayotte": {
    LongName: "Territorial Collectivity of Mayotte",
    Id: 331
  },
  "Montserrat": {
    LongName: "Montserrat",
    Id: 332
  },
  "Netherlands Antilles (Former)": {
    LongName: "",
    Id: 333
  },
  "New Caledonia": {
    LongName: "Territory of New Caledonia and Dependencies",
    Id: 334
  },
  "Niue": {
    LongName: "",
    Id: 335
  },
  "Norfolk Island": {
    LongName: "Territory of Norfolk Island",
    Id: 336
  },
  "Northern Mariana Islands": {
    LongName: "Commonwealth of the Northern Mariana Islands",
    Id: 337
  },
  "Palmyra Atoll": {
    LongName: "",
    Id: 338
  },
  "Pitcairn Islands": {
    LongName: "Pitcairn, Henderson, Ducie, and Oeno Islands",
    Id: 339
  },
  "Rota Island": {
    LongName: "",
    Id: 340
  },
  "Saipan": {
    LongName: "",
    Id: 341
  },
  "South Georgia and the South Sandwich Islands": {
    LongName: "South Georgia and the South Sandwich Islands",
    Id: 342
  },
  "St Helena, Ascension and Tristan da Cunha": {
    LongName: "Saint Helena, Ascension, and Tristan da Cunha",
    Id: 343
  },
  "Tinian Island": {
    LongName: "",
    Id: 346
  },
  "Tokelau": {
    LongName: "Tokelau",
    Id: 347
  },
  "Tristan da Cunha": {
    LongName: "",
    Id: 348
  },
  "Turks and Caicos Islands": {
    LongName: "Turks and Caicos Islands",
    Id: 349
  },
  "British Virgin Islands": {
    LongName: "British Virgin Islands",
    Id: 351
  },
  "Wallis and Futuna": {
    LongName: "Territory of the Wallis and Futuna Islands",
    Id: 352
  },
  "Africa": {
    LongName: "",
    Id: 742
  },
  "Asia": {
    LongName: "",
    Id: 2129
  },
  "Europe": {
    LongName: "",
    Id: 10541
  },
  "Isle of Man": {
    LongName: "Isle of Man",
    Id: 15126
  },
  "North Macedonia": {
    LongName: "The Former Yugoslav Republic of North Macedonia",
    Id: 19618
  },
  "Melanesia": {
    LongName: "",
    Id: 20900
  },
  // 'Micronesia': { LongName: 'Federated States of Micronesia', Id: 21206 },
  "Midway Islands": {
    LongName: "",
    Id: 21242
  },
  "Northern America": {
    LongName: "",
    Id: 23581
  },
  "Polynesia": {
    LongName: "",
    Id: 26286
  },
  "Central America": {
    LongName: "",
    Id: 27082
  },
  "Oceania": {
    LongName: "",
    Id: 27114
  },
  "Sint Maarten": {
    LongName: "Country of Sint Maarten",
    Id: 30967
  },
  "South America": {
    LongName: "",
    Id: 31396
  },
  "Saint Martin": {
    LongName: "Overseas Collectivity of Saint Martin",
    Id: 31706
  },
  "World": {
    LongName: "",
    Id: 39070
  },
  "Western Africa": {
    LongName: "",
    Id: 42483
  },
  "Middle Africa": {
    LongName: "",
    Id: 42484
  },
  "Northern Africa": {
    LongName: "",
    Id: 42487
  },
  "Central Asia": {
    LongName: "",
    Id: 47590
  },
  "South-Eastern Asia": {
    LongName: "",
    Id: 47599
  },
  "Eastern Asia": {
    LongName: "",
    Id: 47600
  },
  "Eastern Africa": {
    LongName: "",
    Id: 47603
  },
  "Eastern Europe": {
    LongName: "",
    Id: 47609
  },
  "Southern Europe": {
    LongName: "",
    Id: 47610
  },
  "Middle East": {
    LongName: "Western Asia",
    Id: 47611
  },
  "Southern Asia": {
    LongName: "",
    Id: 47614
  },
  "Timor-Leste": {
    LongName: "Democratic Republic of Timor-Leste",
    Id: 7299303
  },
  "Kosovo": {
    LongName: "Kosovo",
    Id: 9914689
  },
  "Americas": {
    LongName: "",
    Id: 10026358
  },
  "\xC5land Islands": {
    LongName: "\xC5land Islands",
    Id: 10028789
  },
  "Caribbean": {
    LongName: "",
    Id: 10039880
  },
  "Northern Europe": {
    LongName: "",
    Id: 10039882
  },
  "Southern Africa": {
    LongName: "",
    Id: 10039883
  },
  "Western Europe": {
    LongName: "",
    Id: 10210824
  },
  "Australia and New Zealand": {
    LongName: "",
    Id: 10210825
  },
  "Saint Barth\xE9lemy": {
    LongName: "Overseas Collectivity of Saint Barth\xE9lemy",
    Id: 161832015
  },
  "U.S. Minor Outlying Islands": {
    LongName: "United States Minor Outlying Islands",
    Id: 161832256
  },
  "Latin America and the Caribbean": {
    LongName: "",
    Id: 161832257
  },
  "Bonaire, Sint Eustatius and Saba": {
    LongName: "",
    Id: 161832258
  }
};
var getLocationId = (key) => {
  if (!key) return void 0;
  const location = LOCATIONS[key];
  if (!location) throw new Error(`Location '${key}' not found`);
  return location.Id;
};

// config/_lockout.ts
var LockouParams = [
  "LockoutThreshold",
  "LockoutDuration",
  "LockoutWindow"
];
var _getParams = (opts) => {
  if (opts === "DisableLockoutSettings") return [
    "/lockoutthreshold:0"
  ];
  if (!isObject(opts)) return [];
  return LockouParams.map((name) => {
    const val = opts[name];
    return val === void 0 ? null : `/${name.toLowerCase()}:${val}`;
  }).filter(Boolean);
};
var getLockoutParams = (params) => ({
  LockoutStr: _getParams(params.Lockout).join(" ").trim()
});

// config/_bloatware.ts
var BLOATWARE = [
  [
    "RemoveInternetExplorer",
    {
      Capabilities: [
        [
          "Browser.InternetExplorer",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveWindowsMediaPlayer",
    {
      Capabilities: [
        [
          "Media.WindowsMediaPlayer",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveZuneMusic",
    {
      Packages: [
        [
          "Microsoft.ZuneMusic",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveMediaFeatures",
    {
      Features: [
        [
          "MediaPlayback",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveWordPad",
    {
      Capabilities: [
        [
          "Microsoft.Windows.WordPad",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveNotepadClassic",
    {
      Capabilities: [
        [
          "Microsoft.Windows.Notepad",
          [
            "Windows 10"
          ]
        ],
        [
          "Microsoft.Windows.Notepad.System",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveNotepad",
    {
      Packages: [
        [
          "Microsoft.WindowsNotepad",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveStepsRecorder",
    {
      Capabilities: [
        [
          "App.StepsRecorder",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemovePaint",
    {
      Packages: [
        [
          "Microsoft.Paint",
          [
            "Windows 11"
          ]
        ]
      ],
      Capabilities: [
        [
          "Microsoft.Windows.MSPaint",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemovePaint3D",
    {
      Packages: [
        [
          "Microsoft.MSPaint",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveSkype",
    {
      Packages: [
        [
          "Microsoft.SkypeApp",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveSnippingTool",
    {
      Packages: [
        [
          "Microsoft.ScreenSketch",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ],
      Features: [
        [
          "Microsoft-SnippingTool",
          [
            "Windows 10"
          ]
        ]
      ],
      Capabilities: [
        [
          "Microsoft.Windows.SnippingTool",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveZuneVideo",
    {
      Packages: [
        [
          "Microsoft.ZuneVideo",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveXboxApps",
    {
      Packages: [
        [
          "Microsoft.Xbox.TCUI",
          [
            "Windows 10",
            "Windows 11"
          ]
        ],
        [
          "Microsoft.XboxApp",
          [
            "Windows 10"
          ]
        ],
        [
          "Microsoft.XboxGameOverlay",
          [
            "Windows 10",
            "Windows 11"
          ]
        ],
        [
          "Microsoft.XboxGamingOverlay",
          [
            "Windows 10",
            "Windows 11"
          ]
        ],
        [
          "Microsoft.XboxIdentityProvider",
          [
            "Windows 10",
            "Windows 11"
          ]
        ],
        [
          "Microsoft.XboxSpeechToTextOverlay",
          [
            "Windows 10",
            "Windows 11"
          ]
        ],
        [
          "Microsoft.GamingApp",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemovePhotos",
    {
      Packages: [
        [
          "Microsoft.Windows.Photos",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveNews",
    {
      Packages: [
        [
          "Microsoft.BingNews",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveWeather",
    {
      Packages: [
        [
          "Microsoft.BingWeather",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemovePeople",
    {
      Packages: [
        [
          "Microsoft.People",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveToDo",
    {
      Packages: [
        [
          "Microsoft.Todos",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveSolitaire",
    {
      Packages: [
        [
          "Microsoft.MicrosoftSolitaireCollection",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveStickyNotes",
    {
      Packages: [
        [
          "Microsoft.MicrosoftStickyNotes",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "Remove3DViewer",
    {
      Packages: [
        [
          "Microsoft.Microsoft3DViewer",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveMaps",
    {
      Packages: [
        [
          "Microsoft.WindowsMaps",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveVoiceRecorder",
    {
      Packages: [
        [
          "Microsoft.WindowsSoundRecorder",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveClipchamp",
    {
      Packages: [
        [
          "Clipchamp.Clipchamp",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemovePowerAutomate",
    {
      Packages: [
        [
          "Microsoft.PowerAutomateDesktop",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveWindowsTerminal",
    {
      Packages: [
        [
          "Microsoft.WindowsTerminal",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveOneNote",
    {
      Packages: [
        [
          "Microsoft.Office.OneNote",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveClock",
    {
      Packages: [
        [
          "Microsoft.WindowsAlarms",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveCalculator",
    {
      Packages: [
        [
          "Microsoft.WindowsCalculator",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveCamera",
    {
      Packages: [
        [
          "Microsoft.WindowsCamera",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveYourPhone",
    {
      Packages: [
        [
          "Microsoft.YourPhone",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveGetHelp",
    {
      Packages: [
        [
          "Microsoft.GetHelp",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveFeedbackHub",
    {
      Packages: [
        [
          "Microsoft.WindowsFeedbackHub",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveOffice365",
    {
      Packages: [
        [
          "Microsoft.MicrosoftOfficeHub",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveGetStarted",
    {
      Packages: [
        [
          "Microsoft.Getstarted",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveCortana",
    {
      Packages: [
        [
          "Microsoft.549981C3F5F10",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveMathInputPanel",
    {
      Capabilities: [
        [
          "MathRecognizer",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemovePowerShellISE",
    {
      Capabilities: [
        [
          "Microsoft.Windows.PowerShell.ISE",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveOpenSSHClient",
    {
      Capabilities: [
        [
          "OpenSSH.Client",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveOneDrive",
    {}
  ],
  [
    "RemoveTeams",
    {
      Packages: [
        [
          "MicrosoftTeams",
          [
            "Windows 11 23H2"
          ]
        ],
        [
          "MSTeams",
          [
            "Windows 11 24H2"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveQuickAssist",
    {
      Packages: [
        [
          "MicrosoftCorporationII.QuickAssist",
          [
            "Windows 11"
          ]
        ]
      ],
      Capabilities: [
        [
          "App.Support.QuickAssist",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveFamily",
    {
      Packages: [
        [
          "MicrosoftCorporationII.MicrosoftFamily",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveMailCalendar",
    {
      Packages: [
        [
          "microsoft.windowscommunicationsapps",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveOutlook",
    {
      Packages: [
        [
          "Microsoft.OutlookForWindows",
          [
            "Windows 11 24H2"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveDevHome",
    {
      Packages: [
        [
          "Microsoft.Windows.DevHome",
          [
            "Windows 11 24H2"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveCopilot",
    {
      Packages: [
        [
          "Microsoft.Copilot",
          [
            "Windows 11 25H2"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveBingSearch",
    {
      Packages: [
        [
          "Microsoft.BingSearch",
          [
            "Windows 11 24H2"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveMixedReality",
    {
      Packages: [
        [
          "Microsoft.MixedReality.Portal",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveRecall",
    {
      Features: [
        [
          "Recall",
          [
            "Windows 11 24H2"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveRdpClient",
    {
      Features: [
        [
          "Microsoft-RemoteDesktopConnection",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveWallet",
    {
      Packages: [
        [
          "Microsoft.Wallet",
          [
            "Windows 10"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveWindowsHello",
    {
      Capabilities: [
        [
          "Hello.Face.18967",
          [
            "Windows 10"
          ]
        ],
        [
          "Hello.Face.Migration.18967",
          [
            "Windows 10"
          ]
        ],
        [
          "Hello.Face.20134",
          [
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemovePowerShell2",
    {
      Features: [
        [
          "MicrosoftWindowsPowerShellV2Root",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveHandwriting",
    {
      Capabilities: [
        [
          "Language.Handwriting",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveSpeech",
    {
      Capabilities: [
        [
          "Language.Speech",
          [
            "Windows 10",
            "Windows 11"
          ]
        ],
        [
          "Language.TextToSpeech",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveFaxAndScan",
    {
      Capabilities: [
        [
          "Print.Fax.Scan",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveOneSync",
    {
      Capabilities: [
        [
          "OneCoreUAP.OneSync",
          [
            "Windows 10",
            "Windows 11"
          ]
        ]
      ]
    }
  ],
  [
    "RemoveGameAssist",
    {
      Packages: [
        [
          "Microsoft.Edge.GameAssist",
          [
            "Windows 11 27902.1000"
          ]
        ]
      ]
    }
  ]
];
var BLOATWARE_MAP = new Map(BLOATWARE);
var _collect = (acc, list = []) => acc.push(...list.map((p) => p[0]));
var getRemoveBloatwareParams = (params = {}, indent = 0) => {
  const Ps1List = makePs1List(indent);
  const remove = [
    [],
    [],
    []
  ];
  for (const key of Array.from(BLOATWARE_MAP.keys()).sort()) {
    if (!params[key]) continue;
    const bloatware = BLOATWARE_MAP.get(key);
    _collect(remove[0], bloatware.Packages || []);
    _collect(remove[1], bloatware.Features || []);
    _collect(remove[2], bloatware.Capabilities || []);
  }
  return {
    removePackages: Ps1List(remove[0]),
    removeFeatures: Ps1List(remove[1]),
    removeCapabilities: Ps1List(remove[2])
  };
};

// config/_start-folders.ts
var START_FOLDER = {
  Settings: "hghzUqpRQ0Kfeyd2WEZZ1A==",
  FileExplorer: "vCSKFAzWiUKggG7Zu6JIgg==",
  Documents: "ztU0LVr6Q0WC8iLm6vd3PA==",
  Downloads: "L7Nn496JVUO/zmHzexipNw==",
  Music: "IAYLsFF/MkyqHjTMVH9zFQ==",
  Pictures: "oAc/OArogEywWobbhF28TQ==",
  Videos: "xaWzQoZ99EKApJP6ynqItQ==",
  Network: "RIF1/g0IrkKL2jTtl7ZjlA==",
  PersonalFolder: "SrC9dEr5aE+L1kOYBx2ovA=="
};
var _getStartFolders = (keys) => (keys || []).map((key) => {
  const name = START_FOLDER[key];
  if (!name) throw new Error(`Start folder '${key}' not found`);
  return name;
});
function _b64_encode(ab) {
  return Buffer.from(ab).toString("base64");
}
function _b64_decode(str) {
  var b = Buffer.from(str, "base64");
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
function _u8_merge(arrays) {
  const totalSize = arrays.reduce((acc, e) => acc + e.length, 0);
  const merged = new Uint8Array(totalSize);
  arrays.reduce((offset, array) => (merged.set(array, offset), offset + array.length), 0);
  return merged;
}
function _joinBase64(strs) {
  if (strs.length === 0) return "";
  return _b64_encode(_u8_merge(strs.map(_b64_decode)));
}
var getStartFoldersParams = (params) => {
  return {
    FoldersOnStart: _joinBase64(_getStartFolders(params.FoldersOnStart))
  };
};

// config/config.ts
var getDefaultParams = () => ({
  // Language and Locale settings
  UILanguage: "",
  SystemLocale: "",
  InputLocale: [],
  UserLocale: "",
  SetupUILanguage: "",
  WindowsPeOptions: "",
  GeoId: "",
  TimeZone: "",
  // System settings
  ProcessorArchitecture: "amd64",
  // Windows features
  ProtectYourPC: "Recommended",
  // OOBE settings
  HideEULAPage: true,
  HideWirelessSetupInOOBE: true,
  HideOnlineAccountScreens: true,
  FirstLogonCommands: [],
  // Product key and licensing
  ProductKey: "",
  AcceptEula: true,
  UseConfigurationSet: false,
  WillShowUI: "Always",
  // User account settings
  Username: "user",
  DisplayName: "user",
  Password: "user",
  AutoLogonEnabled: true,
  PasswordExpiration: "DefaultPasswordExpirationSettings",
  Lockout: "DefaultLockoutSettings",
  // UI and appearance settings
  HideFiles: "None",
  ClassicContextMenu: false,
  LaunchToThisPC: false,
  ShowEndTask: false,
  DisableWidgets: false,
  LeftTaskbar: false,
  HideTaskViewButton: false,
  ShowAllTrayIcons: false,
  DisableBingResults: false,
  // System features and security
  AllowPowerShellScripts: false,
  DeleteWindowsOld: false,
  DisableAppSuggestions: false,
  DisableEdgeStartupBoost: false,
  DisableLastAccess: false,
  DisableSmartScreen: false,
  DisableWindowsUpdate: false,
  EnableLongPaths: false,
  EnableRemoteDesktop: false,
  HardenSystemDriveAcl: false,
  HideEdgeFre: false,
  MakeEdgeUninstallable: false,
  PreventAutomaticReboot: false,
  PreventDeviceEncryption: false,
  TurnOffSystemSounds: false,
  // Visual effects and icons
  Effects: [],
  FoldersOnStart: [],
  DesktopIcons: [],
  // Legacy/unsorted options
  DisableFastStartup: false,
  DisableSystemRestore: false,
  DisableUac: false,
  ShowFileExtensions: false,
  // -- My custom -- --
  NoDriveAutoRun: false,
  StartHideRecommended: false
});
var BloatwareListIndent = 2;
var getParams = (params = {}) => ({
  ...getDefaultParams(),
  ...params,
  ...getWindowsPeParams(params),
  ...getGenericKeys(params),
  ...getLockoutParams(params),
  ...getRemoveBloatwareParams(params, BloatwareListIndent),
  ...getStartFoldersParams(params),
  ...getDesktopIcons(params),
  ...getMiscParams(params),
  InputLocale: getInputLocale(params.InputLocale),
  GeoId: getLocationId(params.GeoId)
});

// features/compiled/01_WindowsPE.xml.js
function WindowsPE_xml_default($) {
  const p = [];
  p.push(`<settings pass="windowsPE">
  <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="`, $.ProcessorArchitecture, `" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">`);
  if ($.SetupUILanguage) {
    p.push(`
    <UILanguage>`, $.SetupUILanguage, `</UILanguage>
`);
  }
  p.push(`  </component>
  <component name="Microsoft-Windows-Setup" processorArchitecture="`, $.ProcessorArchitecture, `" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
    <ImageInstall>
      <OSImage>`);
  if ($.PartitionMode === "Unattended") {
    p.push(`
        <InstallTo>
          <DiskID>0</DiskID>
          <PartitionID>3</PartitionID>
        </InstallTo>`);
  }
  if ($.CompactOsMode) {
    p.push(`
        <Compact>`, $.CompactOsMode, `</Compact>
`);
  }
  p.push(`
      </OSImage>
    </ImageInstall>
    <UserData>
      <ProductKey>`);
  if ($.ProductKey) {
    p.push(`
        <Key>`, $.ProductKey, `</Key>
`);
  }
  p.push(`        <WillShowUI>`, $.WillShowUI, `</WillShowUI>
      </ProductKey>
      <AcceptEula>`, $.AcceptEula, `</AcceptEula>
    </UserData>
    <UseConfigurationSet>`, $.UseConfigurationSet, `</UseConfigurationSet>
    <RunSynchronous>
    `);
  for (const [index, command] of $.WindowsPeCmds.entries()) {
    p.push(`  <RunSynchronousCommand wcm:action="add">
        <Order>`, index + 1, `</Order>
        <Path>`, command, `</Path>
      </RunSynchronousCommand>
    `);
  }
  p.push(`</RunSynchronous>
  </component>
</settings>`);
  return p.join("");
}

// features/compiled/02_Specialize.xml.js
function Specialize_xml_default($) {
  const p = [];
  p.push(`<settings pass="specialize">
  <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
    <ProductKey>`, $.ProductKey, `</ProductKey>
    <TimeZone>`, $.TimeZone, `</TimeZone>
  </component>
  <component name="Microsoft-Windows-Deployment" processorArchitecture="`, $.ProcessorArchitecture, `" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
    <RunSynchronous>
      <RunSynchronousCommand wcm:action="add">
        <Order>1</Order>
        <Path>powershell.exe -WindowStyle Normal -NoProfile -Command "$xml = [xml]::new(); $xml.Load('C:\\Windows\\Panther\\unattend.xml'); $sb = [scriptblock]::Create( $xml.unattend.Extensions.ExtractScript ); Invoke-Command -ScriptBlock $sb -ArgumentList $xml;"</Path>
      </RunSynchronousCommand>
      <RunSynchronousCommand wcm:action="add">
        <Order>2</Order>
        <Path>powershell.exe -WindowStyle Normal -NoProfile -Command "Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\Specialize.ps1' -Raw | Invoke-Expression;"</Path>
      </RunSynchronousCommand>
      <RunSynchronousCommand wcm:action="add">
        <Order>3</Order>
        <Path>reg.exe load "HKU\\DefaultUser" "C:\\Users\\Default\\NTUSER.DAT"</Path>
      </RunSynchronousCommand>
      <RunSynchronousCommand wcm:action="add">
        <Order>4</Order>
        <Path>powershell.exe -WindowStyle Normal -NoProfile -Command "Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\DefaultUser.ps1' -Raw | Invoke-Expression;"</Path>
      </RunSynchronousCommand>
      <RunSynchronousCommand wcm:action="add">
        <Order>5</Order>
        <Path>reg.exe unload "HKU\\DefaultUser"</Path>
      </RunSynchronousCommand>
    </RunSynchronous>
  </component>
</settings>`);
  return p.join("");
}

// features/compiled/03_oobeSystem.xml.js
function oobeSystem_xml_default($) {
  const p = [];
  p.push(`<settings pass="oobeSystem">
  <component name="Microsoft-Windows-International-Core" processorArchitecture="`, $.ProcessorArchitecture, `" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">`);
  if ($.InputLocale) {
    p.push(`
    <InputLocale>`, $.InputLocale, `</InputLocale>`);
  }
  if ($.UILanguage) {
    p.push(`
    <SystemLocale>`, $.UILanguage, `</SystemLocale>
    <UILanguage>`, $.UILanguage, `</UILanguage>
    <UserLocale>`, $.UILanguage, `</UserLocale>`);
  }
  p.push(`
  </component>
  <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="`, $.ProcessorArchitecture, `" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
    <UserAccounts>
      <LocalAccounts>
        <LocalAccount wcm:action="add">
          <Name>`, $.Username, `</Name>
          <DisplayName>`, $.DisplayName, `</DisplayName>
          <Group>Administrators</Group>
          <Password>
            <Value>`, $.Password, `</Value>
            <PlainText>true</PlainText>
          </Password>
        </LocalAccount>
      </LocalAccounts>
    </UserAccounts>
    <AutoLogon>
      <Username>`, $.Username, `</Username>
      <Enabled>`, $.AutoLogonEnabled, `</Enabled>
      <LogonCount>1</LogonCount>
      <Password>
        <Value>`, $.Password, `</Value>
        <PlainText>true</PlainText>
      </Password>
    </AutoLogon>
    <OOBE>
      <ProtectYourPC>`, $.ProtectYourPC, `</ProtectYourPC>
      <HideEULAPage>`, $.HideEULAPage, `</HideEULAPage>
      <HideWirelessSetupInOOBE>`, $.HideWirelessSetupInOOBE, `</HideWirelessSetupInOOBE>
      <HideOnlineAccountScreens>`, $.HideOnlineAccountScreens, `</HideOnlineAccountScreens>
    </OOBE>
    <FirstLogonCommands>`);
  for (const [index, command] of $.FirstLogonCommands.entries()) {
    p.push(`
      <SynchronousCommand wcm:action="add">
        <Order>`, index + 1, `</Order>
        <CommandLine>`, command, `</CommandLine>
      </SynchronousCommand>
    `);
  }
  p.push(`</FirstLogonCommands>
  </component>
</settings>`);
  return p.join("");
}

// features/compiled/04_WriteFiles.ps1.js
function WriteFiles_ps1_default($) {
  const p = [];
  p.push(`param(
    [xml] $Document
);

foreach( $file in $Document.unattend.Extensions.File ) {
    $path = [System.Environment]::ExpandEnvironmentVariables( $file.GetAttribute( 'path' ) );
    mkdir -Path( $path | Split-Path -Parent ) -ErrorAction 'SilentlyContinue';
    $encoding = switch( [System.IO.Path]::GetExtension( $path ) ) {
        { $_ -in '.ps1', '.xml' } { [System.Text.Encoding]::UTF8; }
        { $_ -in '.reg', '.vbs', '.js' } { [System.Text.UnicodeEncoding]::new( $false, $true ); }
        default { [System.Text.Encoding]::Default; }
    };
    $bytes = $encoding.GetPreamble() + $encoding.GetBytes( $file.InnerText.Trim() );
    [System.IO.File]::WriteAllBytes( $path, $bytes );
}`);
  return p.join("");
}

// features/compiled/05_RemovePackages.ps1.js
function RemovePackages_ps1_default($) {
  const p = [];
  p.push(`$selectors = @(
`, $.removePackages, `
);
$getCommand = {
  Get-AppxProvisionedPackage -Online;
};
$filterCommand = {
  $_.DisplayName -eq $selector;
};
$removeCommand = {
  [CmdletBinding()]
  param(
    [Parameter( Mandatory, ValueFromPipeline )]
    $InputObject
  );
  process {
    $InputObject | Remove-AppxProvisionedPackage -AllUsers -Online -ErrorAction 'Continue';
  }
};
$type = 'Package';
$logfile = 'C:\\Windows\\Setup\\Scripts\\RemovePackages.log';
& {
  $installed = & $getCommand;
  foreach( $selector in $selectors ) {
    $result = [ordered] @{
      Selector = $selector;
    };
    $found = $installed | Where-Object -FilterScript $filterCommand;
    if( $found ) {
      $result.Output = $found | & $removeCommand;
      if( $? ) {
        $result.Message = "$type removed.";
      } else {
        $result.Message = "$type not removed.";
        $result.Error = $Error[0];
      }
    } else {
      $result.Message = "$type not installed.";
    }
    $result | ConvertTo-Json -Depth 3 -Compress;
  }
} *>&1 >> $logfile;`);
  return p.join("");
}

// features/compiled/06_RemoveCapabilities.ps1.js
function RemoveCapabilities_ps1_default($) {
  const p = [];
  p.push(`$selectors = @(
`, $.removeCapabilities, `
);
$getCommand = {
  Get-WindowsCapability -Online | Where-Object -Property 'State' -NotIn -Value @(
    'NotPresent';
    'Removed';
  );
};
$filterCommand = {
  ($_.Name -split '~')[0] -eq $selector;
};
$removeCommand = {
  [CmdletBinding()]
  param(
    [Parameter( Mandatory, ValueFromPipeline )]
    $InputObject
  );
  process {
    $InputObject | Remove-WindowsCapability -Online -ErrorAction 'Continue';
  }
};
$type = 'Capability';
$logfile = 'C:\\Windows\\Setup\\Scripts\\RemoveCapabilities.log';
& {
  $installed = & $getCommand;
  foreach( $selector in $selectors ) {
    $result = [ordered] @{
      Selector = $selector;
    };
    $found = $installed | Where-Object -FilterScript $filterCommand;
    if( $found ) {
      $result.Output = $found | & $removeCommand;
      if( $? ) {
        $result.Message = "$type removed.";
      } else {
        $result.Message = "$type not removed.";
        $result.Error = $Error[0];
      }
    } else {
      $result.Message = "$type not installed.";
    }
    $result | ConvertTo-Json -Depth 3 -Compress;
  }
} *>&1 >> $logfile;`);
  return p.join("");
}

// features/compiled/07_RemoveFeatures.ps1.js
function RemoveFeatures_ps1_default($) {
  const p = [];
  p.push(`$selectors = @(
`, $.removeFeatures, `
);
$getCommand = {
  Get-WindowsOptionalFeature -Online | Where-Object -Property 'State' -NotIn -Value @(
    'Disabled';
    'DisabledWithPayloadRemoved';
  );
};
$filterCommand = {
  $_.FeatureName -eq $selector;
};
$removeCommand = {
  [CmdletBinding()]
  param(
    [Parameter( Mandatory, ValueFromPipeline )]
    $InputObject
  );
  process {
    $InputObject | Disable-WindowsOptionalFeature -Online -Remove -NoRestart -ErrorAction 'Continue';
  }
};
$type = 'Feature';
$logfile = 'C:\\Windows\\Setup\\Scripts\\RemoveFeatures.log';
& {
  $installed = & $getCommand;
  foreach( $selector in $selectors ) {
    $result = [ordered] @{
      Selector = $selector;
    };
    $found = $installed | Where-Object -FilterScript $filterCommand;
    if( $found ) {
      $result.Output = $found | & $removeCommand;
      if( $? ) {
        $result.Message = "$type removed.";
      } else {
        $result.Message = "$type not removed.";
        $result.Error = $Error[0];
      }
    } else {
      $result.Message = "$type not installed.";
    }
    $result | ConvertTo-Json -Depth 3 -Compress;
  }
} *>&1 >> $logfile;`);
  return p.join("");
}

// features/compiled/08_TaskbarLayoutModification.xml.js
function TaskbarLayoutModification_xml_default($) {
  const p = [];
  p.push(`<LayoutModificationTemplate xmlns="http://schemas.microsoft.com/Start/2014/LayoutModification" xmlns:defaultlayout="http://schemas.microsoft.com/Start/2014/FullDefaultLayout" xmlns:start="http://schemas.microsoft.com/Start/2014/StartLayout" xmlns:taskbar="http://schemas.microsoft.com/Start/2014/TaskbarLayout" Version="1">
  <CustomTaskbarLayoutCollection PinListPlacement="Replace">
    <defaultlayout:TaskbarLayout>
      <taskbar:TaskbarPinList>
        <taskbar:DesktopApp DesktopApplicationLinkPath="#leaveempty" />
      </taskbar:TaskbarPinList>
    </defaultlayout:TaskbarLayout>
  </CustomTaskbarLayoutCollection>
</LayoutModificationTemplate>`);
  return p.join("");
}

// features/compiled/09_UnlockStartLayout.vbs.js
function UnlockStartLayout_vbs_default($) {
  return `HKU = &H80000003
Set reg = GetObject("winmgmts://./root/default:StdRegProv")
Set fso = CreateObject("Scripting.FileSystemObject")

If reg.EnumKey(HKU, "", sids) = 0 Then
  If Not IsNull(sids) Then
    For Each sid In sids
      key = sid + "\\Software\\Policies\\Microsoft\\Windows\\Explorer"
      name = "LockedStartLayout"
      If reg.GetDWORDValue(HKU, key, name, existing) = 0 Then
        reg.SetDWORDValue HKU, key, name, 0
      End If
    Next
  End If
End If`;
}

// features/compiled/10_UnlockStartLayout.xml.js
function UnlockStartLayout_xml_default($) {
  const p = [];
  p.push(`<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Application"&gt;&lt;Select Path="Application"&gt;*[System[Provider[@Name='UnattendGenerator'] and EventID=1]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT72H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Windows\\System32\\wscript.exe</Command>
      <Arguments>C:\\Windows\\Setup\\Scripts\\UnlockStartLayout.vbs</Arguments>
    </Exec>
  </Actions>
</Task>`);
  return p.join("");
}

// features/compiled/11_PauseWindowsUpdate.ps1.js
function PauseWindowsUpdate_ps1_default($) {
  const p = [];
  p.push(`$formatter = {
  $args[0].ToString( "yyyy'-'MM'-'dd'T'HH':'mm':'ssK" );
};
$now = [datetime]::UtcNow;
$start = & $formatter $now;
$end = & $formatter $now.AddDays( 7 );

$params = @{
  LiteralPath = 'Registry::HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings';
  Type = 'String';
  Force = $true;
};

Set-ItemProperty @params -Name 'PauseFeatureUpdatesStartTime' -Value $start;
Set-ItemProperty @params -Name 'PauseFeatureUpdatesEndTime' -Value $end;
Set-ItemProperty @params -Name 'PauseQualityUpdatesStartTime' -Value $start;
Set-ItemProperty @params -Name 'PauseQualityUpdatesEndTime' -Value $end;
Set-ItemProperty @params -Name 'PauseUpdatesStartTime' -Value $start;
Set-ItemProperty @params -Name 'PauseUpdatesExpiryTime' -Value $end;`);
  return p.join("");
}

// features/compiled/12_PauseWindowsUpdate.xml.js
function PauseWindowsUpdate_xml_default($) {
  const p = [];
  p.push(`<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <BootTrigger>
      <Repetition>
        <Interval>P1D</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-19</UserId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT72H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe</Command>
      <Arguments>-Command "Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\PauseWindowsUpdate.ps1' -Raw | Invoke-Expression;"</Arguments>
    </Exec>
  </Actions>
</Task>`);
  return p.join("");
}

// features/compiled/13_ShowAllTrayIcons.ps1.js
function ShowAllTrayIcons_ps1_default($) {
  const p = [];
  p.push(`if( [System.Environment]::OSVersion.Version.Build -lt 20000 ) {
  # Windows 10
  Set-ItemProperty -LiteralPath 'Registry::HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer' -Name 'EnableAutoTray' -Type 'DWord' -Value 0 -Force;
} else {
  # Windows 11
  Register-ScheduledTask -TaskName 'ShowAllTrayIcons' -Xml $(
    Get-Content -LiteralPath "C:\\Windows\\Setup\\Scripts\\ShowAllTrayIcons.xml" -Raw;
  );
}`);
  return p.join("");
}

// features/compiled/14_ShowAllTrayIcons.xml.js
function ShowAllTrayIcons_xml_default($) {
  const p = [];
  p.push(`<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <GroupId>S-1-5-32-545</GroupId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT72H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Windows\\System32\\wscript.exe</Command>
      <Arguments>C:\\Windows\\Setup\\Scripts\\ShowAllTrayIcons.vbs</Arguments>
    </Exec>
  </Actions>
</Task>`);
  return p.join("");
}

// features/compiled/15_ShowAllTrayIcons.vbs.js
function ShowAllTrayIcons_vbs_default($) {
  return `HKCU = &H80000001
key = "Control Panel\\NotifyIconSettings"
Set reg = GetObject("winmgmts://./root/default:StdRegProv")
If reg.EnumKey(HKCU, key, names) = 0 Then
  If Not IsNull(names) Then
    For Each name In names
      reg.SetDWORDValue HKCU, key + "\\" + name, "IsPromoted", 1
    Next
  End If
End If`;
}

// features/compiled/16_MoveActiveHours.vbs.js
function MoveActiveHours_vbs_default($) {
  return `HKLM = &H80000002
key = "SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings"
Set reg = GetObject("winmgmts://./root/default:StdRegProv")
current = Hour(Now)
reg.SetDWORDValue HKLM, key, "ActiveHoursStart", ( current + 23 ) Mod 24
reg.SetDWORDValue HKLM, key, "ActiveHoursEnd", ( current + 11 ) Mod 24
reg.SetDWORDValue HKLM, key, "SmartActiveHoursState", 2`;
}

// features/compiled/17_MoveActiveHours.xml.js
function MoveActiveHours_xml_default($) {
  const p = [];
  p.push(`<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <BootTrigger>
      <Repetition>
        <Interval>PT4H</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </BootTrigger>
    <RegistrationTrigger>
      <Repetition>
        <Interval>PT4H</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </RegistrationTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-19</UserId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT72H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Windows\\System32\\wscript.exe</Command>
      <Arguments>C:\\Windows\\Setup\\Scripts\\MoveActiveHours.vbs</Arguments>
    </Exec>
  </Actions>
</Task>`);
  return p.join("");
}

// features/compiled/18_TurnOffSystemSounds.ps1.js
function TurnOffSystemSounds_ps1_default($) {
  const p = [];
  p.push(`$excludes = Get-ChildItem -LiteralPath 'Registry::HKU\\DefaultUser\\AppEvents\\EventLabels' |
    Where-Object -FilterScript { ($_ | Get-ItemProperty).ExcludeFromCPL -eq 1; } |
    Select-Object -ExpandProperty 'PSChildName';
Get-ChildItem -Path 'Registry::HKU\\DefaultUser\\AppEvents\\Schemes\\Apps\\*\\*' |
    Where-Object -Property 'PSChildName' -NotIn $excludes |
    Get-ChildItem -Include '.Current' | Set-ItemProperty -Name '(Default)' -Value '';`);
  return p.join("");
}

// features/compiled/19_MakeEdgeUninstallable.ps1.js
function MakeEdgeUninstallable_ps1_default($) {
  const p = [];
  p.push(`$ErrorActionPreference = 'Stop';
& {
  try {
    $params = @{
      LiteralPath = 'C:\\Windows\\System32\\IntegratedServicesRegionPolicySet.json';
      Encoding = 'Utf8';
    };
    $o = Get-Content @params | ConvertFrom-Json;
    $o.policies | ForEach-Object -Process {
      if( $_.guid -eq '{1bca278a-5d11-4acf-ad2f-f9ab6d7f93a6}' ) {
        $_.defaultState = 'enabled';
      }
    };
    $o | ConvertTo-Json -Depth 9 | Out-File @params;
  } catch {
    $_;
  }
} *>&1 >> 'C:\\Windows\\Setup\\Scripts\\MakeEdgeUninstallable.log';`);
  return p.join("");
}

// features/compiled/20_SetStartPins.ps1.js
function SetStartPins_ps1_default($) {
  const p = [];
  p.push(`$json = '{"pinnedList":[]}';
if( [System.Environment]::OSVersion.Version.Build -lt 20000 ) {
  return;
}
$key = 'Registry::HKLM\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start';
New-Item -Path $key -ItemType 'Directory' -ErrorAction 'SilentlyContinue';
Set-ItemProperty -LiteralPath $key -Name 'ConfigureStartPins' -Value $json -Type 'String';`);
  return p.join("");
}

// features/compiled/21_LayoutModification.xml.js
function LayoutModification_xml_default($) {
  const p = [];
  p.push(`<LayoutModificationTemplate Version="1" xmlns="http://schemas.microsoft.com/Start/2014/LayoutModification">
  <LayoutOptions StartTileGroupCellWidth="6" />
  <DefaultLayoutOverride>
    <StartLayoutCollection>
      <StartLayout GroupCellWidth="6" xmlns="http://schemas.microsoft.com/Start/2014/FullDefaultLayout" />
    </StartLayoutCollection>
  </DefaultLayoutOverride>
</LayoutModificationTemplate>`);
  return p.join("");
}

// features/compiled/22_Specialize.ps1.js
function Specialize_ps1_default($) {
  const p = [];
  p.push(`$scripts = @(`);
  if ($.BypassRequirementsCheck) {
    p.push(`
  {
    reg.exe add "HKLM\\SYSTEM\\Setup\\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f;
  };`);
  }
  if ($.BypassNetworkCheck) {
    p.push(`
  {
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\OOBE" /v BypassNRO /t REG_DWORD /d 1 /f;
  };`);
  }
  p.push(`
  {
    Remove-Item -LiteralPath 'Registry::HKLM\\Software\\Microsoft\\WindowsUpdate\\Orchestrator\\UScheduler_Oobe\\DevHomeUpdate' -Force -ErrorAction 'SilentlyContinue';
  };`);
  if ($.RemoveNotepad) {
    p.push(`
  {
    reg.exe add "HKCR\\.txt\\ShellNew" /v ItemName /t REG_EXPAND_SZ /d "@C:\\Windows\\system32\\notepad.exe,-470" /f;
    reg.exe add "HKCR\\.txt\\ShellNew" /v NullFile /t REG_SZ /f;
    reg.exe add "HKCR\\txtfilelegacy" /v FriendlyTypeName /t REG_EXPAND_SZ /d "@C:\\Windows\\system32\\notepad.exe,-469" /f;
    reg.exe add "HKCR\\txtfilelegacy" /ve /t REG_SZ /d "Text Document" /f;
  };`);
  }
  if ($.RemoveOneDrive) {
    p.push(`
  {
    Remove-Item -LiteralPath 'C:\\Users\\Default\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\OneDrive.lnk', 'C:\\Windows\\System32\\OneDriveSetup.exe', 'C:\\Windows\\SysWOW64\\OneDriveSetup.exe' -ErrorAction 'Continue';
  };`);
  }
  p.push(`
  {
    Remove-Item -LiteralPath 'Registry::HKLM\\Software\\Microsoft\\WindowsUpdate\\Orchestrator\\UScheduler_Oobe\\OutlookUpdate' -Force -ErrorAction 'SilentlyContinue';
  };`);
  if ($.RemoveTeams) {
    p.push(`
  {
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Communications" /v ConfigureChatAutoInstall /t REG_DWORD /d 0 /f;
  };`);
  }
  p.push(`
  {
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\RemovePackages.ps1' -Raw | Invoke-Expression;
  };
  {
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\RemoveCapabilities.ps1' -Raw | Invoke-Expression;
  };
  {
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\RemoveFeatures.ps1' -Raw | Invoke-Expression;
  };`);
  if ($.LockoutStr) {
    p.push(`
  {
    net.exe accounts `, $.LockoutStr, `;
  };`);
  }
  p.push(`
  {
    net.exe accounts /maxpwage:UNLIMITED;
  };
  {
    reg.exe add "HKLM\\Software\\Policies\\Microsoft\\Windows\\CloudContent" /v "DisableCloudOptimizedContent" /t REG_DWORD /d 1 /f;
    [System.Diagnostics.EventLog]::CreateEventSource( 'UnattendGenerator', 'Application' );
  };
  {
    Register-ScheduledTask -TaskName 'UnlockStartLayout' -Xml $( Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\UnlockStartLayout.xml' -Raw );
  };`);
  if ($.DisableWindowsUpdate) {
    p.push(`
  {
    Register-ScheduledTask -TaskName 'PauseWindowsUpdate' -Xml $( Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\PauseWindowsUpdate.xml' -Raw );
  };`);
  }
  if ($.DisableSmartScreen) {
    p.push(`
  {
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer" /v SmartScreenEnabled /t REG_SZ /d "Off" /f;
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WTDS\\Components" /v ServiceEnabled /t REG_DWORD /d 0 /f;
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WTDS\\Components" /v NotifyMalicious /t REG_DWORD /d 0 /f;
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WTDS\\Components" /v NotifyPasswordReuse /t REG_DWORD /d 0 /f;
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WTDS\\Components" /v NotifyUnsafeApp /t REG_DWORD /d 0 /f;
    reg.exe add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender Security Center\\Systray" /v HideSystray /t REG_DWORD /d 1 /f;
  };`);
  }
  if ($.DisableUac) {
    p.push(`
  {
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v EnableLUA /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.EnableLongPaths) {
    p.push(`
  {
    reg.exe add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
  };`);
  }
  if ($.EnableRemoteDesktop) {
    p.push(`
  {
    netsh.exe advfirewall firewall set rule group="@FirewallAPI.dll,-28752" new enable=Yes;
    reg.exe add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.HardenSystemDriveAcl) {
    p.push(`
  {
    icacls.exe C:\\ /remove:g "*S-1-5-11"
  };`);
  }
  if ($.AllowPowerShellScripts) {
    p.push(`
  {
    Set-ExecutionPolicy -Scope 'LocalMachine' -ExecutionPolicy 'RemoteSigned' -Force;
  };`);
  }
  if ($.DisableLastAccess) {
    p.push(`
  {
    fsutil.exe behavior set disableLastAccess 1;
  };`);
  }
  if ($.PreventAutomaticReboot) {
    p.push(`
  {
    reg.exe add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v AUOptions /t REG_DWORD /d 4 /f;
    reg.exe add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f;
  };
  {
    Register-ScheduledTask -TaskName 'MoveActiveHours' -Xml $( Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\MoveActiveHours.xml' -Raw );
  };`);
  }
  if ($.DisableFastStartup) {
    p.push(`
  {
    reg.exe add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.DisableSystemRestore) {
    p.push(`
  {
    Disable-ComputerRestore -Drive 'C:\\';
  };`);
  }
  if ($.DisableWidgets) {
    p.push(`
  {
    reg.exe add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.TurnOffSystemSounds) {
    p.push(`
  {
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Authentication\\LogonUI\\BootAnimation" /v DisableStartupSound /t REG_DWORD /d 1 /f;
    reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\EditionOverrides" /v UserSetting_DisableStartupSound /t REG_DWORD /d 1 /f;
  };`);
  }
  if ($.DisableAppSuggestions) {
    p.push(`
  {
    reg.exe add "HKLM\\Software\\Policies\\Microsoft\\Windows\\CloudContent" /v "DisableWindowsConsumerFeatures" /t REG_DWORD /d 1 /f;
  };`);
  }
  if ($.PreventDeviceEncryption) {
    p.push(`
  {
    reg.exe add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\BitLocker" /v "PreventDeviceEncryption" /t REG_DWORD /d 1 /f;
  };`);
  }
  if ($.HideEdgeFre) {
    p.push(`
  {
    reg.exe add "HKLM\\Software\\Policies\\Microsoft\\Edge" /v HideFirstRunExperience /t REG_DWORD /d 1 /f;
  };`);
  }
  if ($.DisableEdgeStartupBoost) {
    p.push(`
  {
    reg.exe add "HKLM\\Software\\Policies\\Microsoft\\Edge\\Recommended" /v BackgroundModeEnabled /t REG_DWORD /d 0 /f;
    reg.exe add "HKLM\\Software\\Policies\\Microsoft\\Edge\\Recommended" /v StartupBoostEnabled /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.MakeEdgeUninstallable) {
    p.push(`
  {
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\MakeEdgeUninstallable.ps1' -Raw | Invoke-Expression;
  };`);
  }
  p.push(`
  {
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\SetStartPins.ps1' -Raw | Invoke-Expression;
  };
  {`);
  for (const [key, value] of $.Effects) {
    p.push(`
    Set-ItemProperty -LiteralPath "Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects\\`, key, `" -Name 'DefaultValue' -Value `, value, ` -Type 'DWord' -Force;`);
  }
  p.push(`
  };
  {
    reg.exe add "HKU\\.DEFAULT\\Control Panel\\Accessibility\\StickyKeys" /v Flags /t REG_SZ /d 10 /f;
  };`);
  if ($.NoDriveAutoRun) {
    p.push(`{
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\NoDriveAutoRun.ps1' -Raw | Invoke-Expression;
  };`);
  }
  if ($.StartHideRecommended) {
    p.push(`
  {
    reg.exe import "C:\\Windows\\Setup\\Scripts\\StartHideRecommended.reg";
  };`);
  }
  p.push(`
);

& {
  [float] $complete = 0;
  [float] $increment = 100 / $scripts.Count;
  foreach( $script in $scripts ) {
    Write-Progress -Activity 'Running scripts to customize your Windows installation. Do not close this window.' -PercentComplete $complete;
    '*** Will now execute command \xAB{0}\xBB.' -f $(
      $str = $script.ToString().Trim() -replace '\\s+', ' ';
      $max = 100;
      if( $str.Length -le $max ) {
        $str;
      } else {
        $str.Substring( 0, $max - 1 ) + '\u2026';
      }
    );
    $start = [datetime]::Now;
    & $script;
    '*** Finished executing command after {0:0} ms.' -f [datetime]::Now.Subtract( $start ).TotalMilliseconds;
    "\`r\`n" * 3;
    $complete += $increment;
  }
} *>&1 >> "C:\\Windows\\Setup\\Scripts\\Specialize.log";`);
  return p.join("");
}

// features/compiled/23_UserOnce.ps1.js
function UserOnce_ps1_default($) {
  const p = [];
  p.push(`$scripts = @(`);
  if ($.GeoId) {
    p.push(`
  {
    Set-WinHomeLocation -GeoId `, $.GeoId, `;
  };`);
  }
  if ($.RemoveCopilot) {
    p.push(`
  {
    Get-AppxPackage -Name 'Microsoft.Windows.Ai.Copilot.Provider' | Remove-AppxPackage;
  };`);
  }
  p.push(`
  {
    [System.Diagnostics.EventLog]::WriteEntry( 'UnattendGenerator', "User '$env:USERNAME' has requested to unlock the Start menu layout.", [System.Diagnostics.EventLogEntryType]::Information, 1 );
  };
  {
    Set-ItemProperty -LiteralPath 'Registry::HKCU\\AppEvents\\Schemes' -Name '(Default)' -Type 'String' -Value '.None';
  };
  `);
  if ($.ClassicContextMenu) {
    p.push(`{
    reg.exe add "HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32" /ve /f;
  };`);
  }
  p.push(`
  `);
  if ($.LaunchToThisPC) {
    p.push(`{
    Set-ItemProperty -LiteralPath 'Registry::HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'LaunchTo' -Type 'DWord' -Value 1;
  };`);
  }
  p.push(`
  {
    Set-ItemProperty -LiteralPath 'Registry::HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search' -Name 'SearchboxTaskbarMode' -Type 'DWord' -Value 0;
  };
  {
    Set-ItemProperty -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' -Name 'VisualFXSetting' -Type 'DWord' -Value 2 -Force;
  };
  {
    New-Item -Path 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\ClassicStartMenu' -Force;`);
  for (const [key, value] of $.DesktopIcons) {
    p.push(`
    Set-ItemProperty -Path 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\ClassicStartMenu' -Name `, key, ` -Value `, value, ` -Type 'DWord';`);
  }
  p.push(`
    New-Item -Path 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\NewStartPanel' -Force;`);
  for (const [key, value] of $.DesktopIcons) {
    p.push(`
    Set-ItemProperty -Path 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\NewStartPanel' -Name `, key, ` -Value `, value, ` -Type 'DWord';`);
  }
  p.push(`
  };`);
  if ($.FoldersOnStart) {
    p.push(`
  {
    Set-ItemProperty -Path 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Start' -Name 'VisiblePlaces' -Value $( [convert]::FromBase64String('`, $.FoldersOnStart, `') ) -Type 'Binary';
  };`);
  }
  p.push(`
  {
    Get-Process -Name 'explorer' -ErrorAction 'SilentlyContinue' | Where-Object -FilterScript {
      $_.SessionId -eq ( Get-Process -Id $PID ).SessionId;
    } | Stop-Process -Force;
  };
);

& {
  [float] $complete = 0;
  [float] $increment = 100 / $scripts.Count;
  foreach( $script in $scripts ) {
    Write-Progress -Activity 'Running scripts to configure this user account. Do not close this window.' -PercentComplete $complete;
    '*** Will now execute command \xAB{0}\xBB.' -f $(
      $str = $script.ToString().Trim() -replace '\\s+', ' ';
      $max = 100;
      if( $str.Length -le $max ) {
        $str;
      } else {
        $str.Substring( 0, $max - 1 ) + '\u2026';
      }
    );
    $start = [datetime]::Now;
    & $script;
    '*** Finished executing command after {0:0} ms.' -f [datetime]::Now.Subtract( $start ).TotalMilliseconds;
    "\`r\`n" * 3;
    $complete += $increment;
  }
} *>&1 >> "$env:TEMP\\UserOnce.log";`);
  return p.join("");
}

// features/compiled/24_DefaultUser.ps1.js
function DefaultUser_ps1_default($) {
  const p = [];
  p.push(`$scripts = @(`);
  if ($.RemoveCopilot) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Policies\\Microsoft\\Windows\\WindowsCopilot" /v TurnOffWindowsCopilot /t REG_DWORD /d 1 /f;
  };`);
  }
  p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Internet Explorer\\LowRegistry\\Audio\\PolicyConfig\\PropertyStore" /f;
  };
  `);
  if ($.RemoveNotepad) {
    p.push(`{
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Notepad" /v ShowStoreBanner /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.RemoveOneDrive) {
    p.push(`
  {
    Remove-ItemProperty -LiteralPath 'Registry::HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'OneDriveSetup' -Force -ErrorAction 'Continue';
  };`);
  }
  if ($.RemoveXboxApps) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 0 /f;
  };`);
  }
  p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Policies\\Microsoft\\Windows\\Explorer" /v "StartLayoutFile" /t REG_SZ /d "C:\\Windows\\Setup\\Scripts\\TaskbarLayoutModification.xml" /f;
    reg.exe add "HKU\\DefaultUser\\Software\\Policies\\Microsoft\\Windows\\Explorer" /v "LockedStartLayout" /t REG_DWORD /d 1 /f;
  };`);
  if ($.ShowFileExtensions) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v "HideFileExt" /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.HideFiles === "None" || $.HideFiles === "HiddenSystem") {
    p.push(`{
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v "Hidden" /t REG_DWORD /d 1 /f;
  }`);
  }
  if ($.HideFiles === "None") {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v "ShowSuperHidden" /t REG_DWORD /d 1 /f;
  }`);
  }
  if ($.ShowAllTrayIcons) {
    p.push(`
  {
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\ShowAllTrayIcons.ps1' -Raw | Invoke-Expression;
  };`);
  }
  if ($.HideTaskViewButton) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v ShowTaskViewButton /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.DisableSmartScreen) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Edge\\SmartScreenEnabled" /ve /t REG_DWORD /d 0 /f;
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Edge\\SmartScreenPuaEnabled" /ve /t REG_DWORD /d 0 /f;
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\AppHost" /v EnableWebContentEvaluation /t REG_DWORD /d 0 /f;
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\AppHost" /v PreventOverride /t REG_DWORD /d 0 /f;
  };`);
  }
  if ($.TurnOffSystemSounds) {
    p.push(`
  {
    Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\TurnOffSystemSounds.ps1' -Raw | Invoke-Expression;
  };`);
  }
  if ($.DisableAppSuggestions) {
    p.push(`
  {
    $names = @(
      'ContentDeliveryAllowed';
      'FeatureManagementEnabled';
      'OEMPreInstalledAppsEnabled';
      'PreInstalledAppsEnabled';
      'PreInstalledAppsEverEnabled';
      'SilentInstalledAppsEnabled';
      'SoftLandingEnabled';
      'SubscribedContentEnabled';
      'SubscribedContent-310093Enabled';
      'SubscribedContent-338387Enabled';
      'SubscribedContent-338388Enabled';
      'SubscribedContent-338389Enabled';
      'SubscribedContent-338393Enabled';
      'SubscribedContent-353694Enabled';
      'SubscribedContent-353696Enabled';
      'SubscribedContent-353698Enabled';
      'SystemPaneSuggestionsEnabled';
    );

    foreach( $name in $names ) {
      reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v $name /t REG_DWORD /d 0 /f;
    }
  };`);
  }
  if ($.LeftTaskbar) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarAl /t REG_DWORD /d 0 /f;
  };`);
  }
  p.push(`
  {
    foreach( $root in 'Registry::HKU\\.DEFAULT', 'Registry::HKU\\DefaultUser' ) {
      Set-ItemProperty -LiteralPath "$root\\Control Panel\\Keyboard" -Name 'InitialKeyboardIndicators' -Type 'String' -Value 0 -Force;
    }
  };`);
  if ($.DisableBingResults) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Policies\\Microsoft\\Windows\\Explorer" /v DisableSearchBoxSuggestions /t REG_DWORD /d 1 /f;
  };`);
  }
  if ($.ShowEndTask) {
    p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\\TaskbarDeveloperSettings" /v TaskbarEndTask /t REG_DWORD /d 1 /f;
  };`);
  }
  p.push(`
  {
    reg.exe add "HKU\\DefaultUser\\Control Panel\\Accessibility\\StickyKeys" /v Flags /t REG_SZ /d 10 /f;
  };
  {
    reg.exe add "HKU\\DefaultUser\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce" /v "UnattendedSetup" /t REG_SZ /d "powershell.exe -WindowStyle Normal -NoProfile -Command \\""Get-Content -LiteralPath 'C:\\Windows\\Setup\\Scripts\\UserOnce.ps1' -Raw | Invoke-Expression;\\""" /f;
  };
);

& {
  [float] $complete = 0;
  [float] $increment = 100 / $scripts.Count;
  foreach( $script in $scripts ) {
    Write-Progress -Activity 'Running scripts to modify the default user&#x2019;&#x2019;s registry hive. Do not close this window.' -PercentComplete $complete;
    '*** Will now execute command \xAB{0}\xBB.' -f $(
      $str = $script.ToString().Trim() -replace '\\s+', ' ';
      $max = 100;
      if( $str.Length -le $max ) {
        $str;
      } else {
        $str.Substring( 0, $max - 1 ) + '\u2026';
      }
    );
    $start = [datetime]::Now;
    & $script;
    '*** Finished executing command after {0:0} ms.' -f [datetime]::Now.Subtract( $start ).TotalMilliseconds;
    "\`r\`n" * 3;
    $complete += $increment;
  }
} *>&1 >> "C:\\Windows\\Setup\\Scripts\\DefaultUser.log";`);
  return p.join("");
}

// features/compiled/25_FirstLogon.ps1.js
function FirstLogon_ps1_default($) {
  const p = [];
  p.push(`$scripts = @(
  {
    Set-ItemProperty -LiteralPath 'Registry::HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -Name 'AutoLogonCount' -Type 'DWord' -Force -Value 0;
  };
  `);
  if ($.DeleteWindowsOld) {
    p.push(`{
    cmd.exe /c "rmdir C:\\Windows.old";
  };`);
  }
  p.push(`
  {
    Remove-Item -LiteralPath @(
      'C:\\Windows\\Panther\\unattend.xml';
      'C:\\Windows\\Panther\\unattend-original.xml';
      'C:\\Windows\\Setup\\Scripts\\Wifi.xml';
    ) -Force -ErrorAction 'SilentlyContinue' -Verbose;
  };
);

& {
  [float] $complete = 0;
  [float] $increment = 100 / $scripts.Count;
  foreach( $script in $scripts ) {
    Write-Progress -Activity 'Running scripts to finalize your Windows installation. Do not close this window.' -PercentComplete $complete;
    '*** Will now execute command \xAB{0}\xBB.' -f $(
      $str = $script.ToString().Trim() -replace '\\s+', ' ';
      $max = 100;
      if( $str.Length -le $max ) {
        $str;
      } else {
        $str.Substring( 0, $max - 1 ) + '\u2026';
      }
    );
    $start = [datetime]::Now;
    & $script;
    '*** Finished executing command after {0:0} ms.' -f [datetime]::Now.Subtract( $start ).TotalMilliseconds;
    "\`r\`n" * 3;
    $complete += $increment;
  }
} *>&1 >> "C:\\Windows\\Setup\\Scripts\\FirstLogon.log";`);
  return p.join("");
}

// features/compiled/50_NoDriveAutoRun.ps1.js
function NoDriveAutoRun_ps1_default($) {
  const p = [];
  p.push(`$params = @{
    Path = 'Registry::HKLM\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Policies\\\\Explorer';
};
New-Item @params -ErrorAction 'SilentlyContinue';
Set-ItemProperty @params -Name 'NoDriveAutoRun' -Type 'DWord' -Value $(
    ( 1 -shl 26 ) - 1; # 0x3FFFFFF
);
Set-ItemProperty @params -Name 'NoDriveTypeAutoRun' -Type 'DWord' -Value $(
    ( 1 -shl 8 ) - 1; # 0xFF
);`);
  return p.join("");
}

// features/compiled/51_StartHideRecommended.reg.js
function StartHideRecommended_reg_default($) {
  return `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINESOFTWAREMicrosoftPolicyManagercurrentdeviceStart]
"HideRecommendedSection"=dword:00000001

[HKEY_LOCAL_MACHINESOFTWAREMicrosoftPolicyManagercurrentdeviceEducation]
"IsEducationEnvironment"=dword:00000001

[HKEY_LOCAL_MACHINESOFTWAREPoliciesMicrosoftWindowsExplorer]
"HideRecommendedSection"=dword:00000001`;
}

// lib/generator.ts
var ExtractScript = makeTag("ExtractScript", 0, 4);
var FileTag = makeTag("File", 0, 4);
var when = (condition, ...lines) => condition ? lines.join("\n    ") : "";
var replaceLink = (content, options) => {
  const value = options["@GeneratorLink@"];
  const link = !value || value === "@GeneratorLinkEmpty@" ? "" : String(value);
  return content.replace("@GeneratorLink@", link);
};
var toWindowsNewlines = (content) => content.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
var generate = (options) => `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  @GeneratorLink@
  <settings pass="offlineServicing"></settings>
  ${indentLines(WindowsPE_xml_default(options), 2)}
  <settings pass="generalize"></settings>
  ${indentLines(Specialize_xml_default(options), 2)}
  <settings pass="auditSystem"></settings>
  <settings pass="auditUser"></settings>
  ${indentLines(oobeSystem_xml_default(options), 2)}
  <Extensions xmlns="https://schneegans.de/windows/unattend-generator/">
    ${[
  ExtractScript(WriteFiles_ps1_default(options)),
  FileTag(RemovePackages_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\RemovePackages.ps1"),
  FileTag(RemoveCapabilities_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\RemoveCapabilities.ps1"),
  FileTag(RemoveFeatures_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\RemoveFeatures.ps1"),
  FileTag(TaskbarLayoutModification_xml_default(options), "C:\\Windows\\Setup\\Scripts\\TaskbarLayoutModification.xml"),
  FileTag(UnlockStartLayout_vbs_default(options), "C:\\Windows\\Setup\\Scripts\\UnlockStartLayout.vbs"),
  FileTag(UnlockStartLayout_xml_default(options), "C:\\Windows\\Setup\\Scripts\\UnlockStartLayout.xml"),
  when(options.DisableWindowsUpdate, FileTag(PauseWindowsUpdate_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\PauseWindowsUpdate.ps1"), FileTag(PauseWindowsUpdate_xml_default(options), "C:\\Windows\\Setup\\Scripts\\PauseWindowsUpdate.xml")),
  when(options.ShowAllTrayIcons, FileTag(ShowAllTrayIcons_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\ShowAllTrayIcons.ps1"), FileTag(ShowAllTrayIcons_xml_default(options), "C:\\Windows\\Setup\\Scripts\\ShowAllTrayIcons.xml"), FileTag(ShowAllTrayIcons_vbs_default(options), "C:\\Windows\\Setup\\Scripts\\ShowAllTrayIcons.vbs")),
  when(options.PreventAutomaticReboot, FileTag(MoveActiveHours_vbs_default(options), "C:\\Windows\\Setup\\Scripts\\MoveActiveHours.vbs"), FileTag(MoveActiveHours_xml_default(options), "C:\\Windows\\Setup\\Scripts\\MoveActiveHours.xml")),
  when(options.TurnOffSystemSounds, FileTag(TurnOffSystemSounds_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\TurnOffSystemSounds.ps1")),
  when(options.MakeEdgeUninstallable, FileTag(MakeEdgeUninstallable_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\MakeEdgeUninstallable.ps1")),
  FileTag(SetStartPins_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\SetStartPins.ps1"),
  FileTag(LayoutModification_xml_default(options), "C:\\Users\\Default\\AppData\\Local\\Microsoft\\Windows\\Shell\\LayoutModification.xml"),
  when(options.NoDriveAutoRun, FileTag(NoDriveAutoRun_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\NoDriveAutoRun.ps1")),
  when(options.StartHideRecommended, FileTag(StartHideRecommended_reg_default(options), "C:\\Windows\\Setup\\Scripts\\StartHideRecommended.reg")),
  FileTag(Specialize_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\Specialize.ps1"),
  FileTag(UserOnce_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\UserOnce.ps1"),
  FileTag(DefaultUser_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\DefaultUser.ps1"),
  FileTag(FirstLogon_ps1_default(options), "C:\\Windows\\Setup\\Scripts\\FirstLogon.ps1")
].filter(Boolean).join("\n    ")}
  </Extensions>
</unattend>`;
var generateXml = (options) => {
  let content = generate(getParams(options));
  content = replaceLink(content, options);
  content = toWindowsNewlines(content);
  return content;
};
var generator_default = generateXml;

// .misc/autounattend.ts
var main = async () => {
  const fname = process.argv[2];
  try {
    const content = readFileSync(fname || process.stdin.fd, "utf-8");
    if (content) process.stdout.write(generator_default(parseJsonc(content)));
  } catch (error) {
    const source = fname ? `file '${fname}'` : "stdin";
    console.error(`Error reading from ${source}: ${error.message}`);
  }
};
main();
