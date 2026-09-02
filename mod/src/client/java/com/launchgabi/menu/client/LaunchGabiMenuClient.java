package com.launchgabi.menu.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;

/**
 * Entry point for the client-only "modern main menu" mod. The button and
 * panel look comes entirely from bundled sprites and the mixin package;
 * this only wires up the one thing that needs to run per screen: reflowing
 * the title screen's button column after it initializes.
 */
public class LaunchGabiMenuClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		ScreenEvents.AFTER_INIT.register(TitleScreenLayout::onAfterInit);
	}
}
