---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "ts-health"
  text: "Health & fitness data, unified."
  tagline: "TypeScript library for Oura Ring, WHOOP, Apple Health, Fitbit, and more."
  image: /images/logo-white.png
  actions:
    - theme: brand
      text: Get Started
      link: /intro
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/ts-health

features:
  - title: "Oura Ring"
    icon: "💍"
    details: "Full API v2 support: sleep, readiness, activity, HRV, SpO2, stress, body temperature, VO2 max."
  - title: "WHOOP"
    icon: "💪"
    details: "Recovery, strain, sleep, workouts, HRV, SpO2, and skin temperature data."
  - title: "Apple Health"
    icon: "🍎"
    details: "Parse XML exports for sleep stages, heart rate, HRV, steps, workouts, and more."
  - title: "Fitbit"
    icon: "⌚"
    details: "Sleep stages, activity summaries, intraday heart rate, HRV, SpO2, and cardio score."
  - title: "Training Readiness"
    icon: "🏋️"
    details: "Analyze HRV trends, sleep quality, recovery, and activity balance for training recommendations."
  - title: "Fully Typed"
    icon: "🔷"
    details: "Comprehensive TypeScript types with a unified HealthDriver interface across all platforms."
---

<Home />
