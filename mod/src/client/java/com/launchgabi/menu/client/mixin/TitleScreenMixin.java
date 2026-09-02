package com.launchgabi.menu.client.mixin;

import net.minecraft.client.gui.screens.TitleScreen;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * First checkpoint only: confirms the whole toolchain (Loom, the declared
 * Mojang mappings, Mixin) actually reaches the title screen before any real
 * visual change is attempted. Milestone 1 replaces this with the real button
 * and layout work.
 */
@Mixin(TitleScreen.class)
public class TitleScreenMixin {
	private static final Logger LOGGER = LoggerFactory.getLogger("launchgabi-menu");

	@Inject(at = @At("TAIL"), method = "init")
	private void launchGabiMenu$onInit(CallbackInfo info) {
		LOGGER.info("[Launch Gabi] Modernes Hauptmenue: TitleScreen.init() erreicht.");
	}
}
